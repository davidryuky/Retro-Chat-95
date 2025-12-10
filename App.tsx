import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DataConnection } from 'peerjs';
import { Send, Copy, LogOut, Terminal, ShieldCheck, User, ArrowLeft, Wifi, WifiOff } from 'lucide-react';
import { Win95Window, Win95Button, Win95Input, Win95Panel } from './components/RetroUI';
import { encryptMessage, decryptMessage, generateRandomKey, generateRandomName } from './utils/crypto';
import { Message, AppScreen, NetworkMessage } from './types';

const App: React.FC = () => {
  // --- State ---
  const [screen, setScreen] = useState<AppScreen>(AppScreen.LOGIN);
  const [username, setUsername] = useState<string>('');
  
  // Connection Setup
  const [isHost, setIsHost] = useState<boolean>(true);
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [targetPeerId, setTargetPeerId] = useState<string>('');
  const [roomKey, setRoomKey] = useState<string>('');
  const [status, setStatus] = useState<string>('Initializing...');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>('');

  // --- Refs ---
  // Use 'any' for Peer to handle dynamic import type differences safely
  const peerRef = useRef<any>(null);
  const connRef = useRef<DataConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- Effects ---

  // Fullscreen trigger on first interaction
  useEffect(() => {
    const handleInteraction = () => {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen && !document.fullscreenElement) {
            docEl.requestFullscreen().catch((err) => {
                console.log("Fullscreen request denied:", err);
            });
        }
    };
    
    window.addEventListener('click', handleInteraction, { once: true });
    window.addEventListener('touchstart', handleInteraction, { once: true });

    return () => {
        window.removeEventListener('click', handleInteraction);
        window.removeEventListener('touchstart', handleInteraction);
    };
  }, []);

  // Initialize Peer on Load
  useEffect(() => {
    const initPeer = async () => {
        try {
            // Dynamic import to handle SSR/Client differences if needed, and import format
            const peerModule = await import('peerjs');
            // Handle different export formats (Default vs Named)
            const PeerCtor = peerModule.Peer || (peerModule as any).default || (window as any).Peer;
            
            if (!PeerCtor) {
                throw new Error("PeerJS library could not be loaded.");
            }

            const peer = new PeerCtor();

            peer.on('open', (id: string) => {
                console.log('My Peer ID is: ' + id);
                setMyPeerId(id);
                setStatus('Online');
                setErrorMsg(null);
            });

            peer.on('connection', (conn: DataConnection) => {
                console.log('Incoming connection from:', conn.peer);
                handleConnection(conn);
            });

            peer.on('error', (err: any) => {
                console.error('Peer error:', err);
                // Don't show "disconnected" error immediately if just network blip
                if (err.type === 'peer-unavailable') {
                     setErrorMsg(`Peer ${targetPeerId} not found.`);
                } else if (err.type === 'network') {
                     setErrorMsg("Network error. Checking connection...");
                } else {
                     setErrorMsg(`System Error: ${err.type || 'Unknown'}`);
                }
            });

            peer.on('disconnected', () => {
                setStatus('Disconnected');
                // Auto-reconnect to server to keep ID alive if possible
                if (peer && !peer.destroyed) {
                    peer.reconnect();
                }
            });

            peerRef.current = peer;
        } catch (e) {
            console.error("Failed to init PeerJS", e);
            setStatus('System Failure');
            setErrorMsg("Could not load communication module.");
        }
    };

    if (!peerRef.current) {
        initPeer();
    }
    
    return () => {
        // Cleanup logic if needed
    };
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    if (screen === AppScreen.CHAT) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, screen]);

  // --- Handlers ---

  const handleConnection = (conn: DataConnection) => {
      connRef.current = conn;
      
      conn.on('open', () => {
          setStatus('Connected');
          setScreen(AppScreen.CHAT);
          setErrorMsg(null);
          // Optional: Send handshake or just wait for messages
      });

      conn.on('data', async (data: any) => {
          const msg = data as NetworkMessage;
          if (msg.type === 'CHAT' && msg.payload && msg.sender) {
             // Handle in the effect below to ensure fresh state/refs
          }
      });
      
      conn.on('close', () => {
          setStatus('Disconnected');
          addSystemMessage('Connection lost.');
          connRef.current = null;
      });
      
      conn.on('error', (err) => {
          console.error("Connection error", err);
          addSystemMessage("Connection error occurred.");
      });
  };

  // Re-bind listener when roomKey changes to ensure we have the correct key in scope
  const roomKeyRef = useRef(roomKey);
  useEffect(() => { roomKeyRef.current = roomKey; }, [roomKey]);

  useEffect(() => {
    if(!connRef.current) return;
    
    const conn = connRef.current;
    
    const dataHandler = async (data: any) => {
        const msg = data as NetworkMessage;
        if (msg.type === 'CHAT' && msg.payload && msg.sender) {
            try {
                const text = await decryptMessage(msg.payload, roomKeyRef.current);
                addMessage(msg.sender, text);
            } catch (e) {
                console.error("Decryption fail", e);
                addSystemMessage(`Encrypted message received from ${msg.sender} but could not decrypt. Check Key.`);
            }
        }
    };

    conn.removeAllListeners('data'); 
    conn.on('data', dataHandler);
    
    return () => {
        conn.removeAllListeners('data');
    };
  }, [connRef.current, messages]); // Re-bind if connection exists


  const connectToPeer = () => {
      if (!peerRef.current || !targetPeerId) {
          setErrorMsg("Please enter a Room ID.");
          return;
      }
      setStatus(`Connecting to ${targetPeerId}...`);
      setErrorMsg(null);
      
      try {
          const conn = peerRef.current.connect(targetPeerId, {
              reliable: true
          });
          
          if (!conn) {
              setErrorMsg("Could not create connection.");
              return;
          }
          
          handleConnection(conn);
          
          // Timeout handling if connection hangs
          setTimeout(() => {
              if (conn.open === false && status.includes('Connecting')) {
                  setErrorMsg("Connection timed out. Is the host online?");
                  setStatus("Online"); // Reset status
              }
          }, 10000);
          
      } catch (e) {
          console.error(e);
          setErrorMsg("Failed to initiate connection.");
      }
  };

  const sendMessage = async () => {
      if (!inputText.trim()) return;
      
      const textToSend = inputText;
      setInputText('');

      // 1. Add to my UI
      addMessage(username, textToSend);

      // 2. Encrypt and Send via P2P
      if (connRef.current && connRef.current.open) {
          try {
              const encrypted = await encryptMessage(textToSend, roomKey);
              const netMsg: NetworkMessage = {
                  type: 'CHAT',
                  sender: username,
                  payload: encrypted
              };
              connRef.current.send(netMsg);
          } catch (e) {
              console.error("Encryption error", e);
              addSystemMessage("Error: Could not encrypt message.");
          }
      } else {
          addSystemMessage("Not connected. Message saved locally.");
      }
  };

  const addMessage = (sender: string, content: string, isSystem = false) => {
      setMessages(prev => [...prev, {
          id: Date.now().toString() + Math.random(),
          sender,
          content,
          timestamp: Date.now(),
          isSystem
      }]);
  };

  const addSystemMessage = (content: string) => {
      addMessage('SYSTEM', content, true);
  };

  const handleLogin = () => {
      if (!username) {
          setUsername(generateRandomName());
      }
      setScreen(AppScreen.SETUP);
      // Auto-generate a key for Host mode if empty
      if (!roomKey) setRoomKey(generateRandomKey());
  };

  const copyToClipboard = (text: string) => {
      navigator.clipboard.writeText(text);
      // Visual feedback could be added here
  };

  // --- Renderers ---

  // 1. LOGIN SCREEN
  if (screen === AppScreen.LOGIN) {
      return (
          <div className="flex-1 flex flex-col items-center justify-center p-4 bg-[#008080]">
               <Win95Window title="RetroChat 95" className="w-full max-w-sm shadow-[8px_8px_0_rgba(0,0,0,0.5)]">
                   <div className="p-6 flex flex-col gap-6 text-center bg-[#c0c0c0]">
                       <div className="flex justify-center mb-2">
                           <div className="p-4 bg-white border-2 border-t-black border-l-black border-b-white border-r-white">
                                <ShieldCheck size={48} className="text-[#000080]" />
                           </div>
                       </div>
                       
                       <div>
                           <h1 className="text-2xl font-bold mb-1">WELCOME USER</h1>
                           <p className="text-sm text-gray-600">Secure Peer-to-Peer Terminal</p>
                       </div>
                       
                       <div className="flex flex-col gap-2 text-left">
                           <label className="font-bold text-sm">CODENAME:</label>
                           <div className="flex gap-2">
                               <Win95Input 
                                   value={username} 
                                   onChange={(e) => setUsername(e.target.value)}
                                   placeholder="Enter name..."
                               />
                               <Win95Button onClick={() => setUsername(generateRandomName())}>
                                   RND
                               </Win95Button>
                           </div>
                       </div>

                       <Win95Button 
                           onClick={handleLogin} 
                           className="py-3 text-xl mt-2 font-bold border-2"
                       >
                           INITIALIZE
                       </Win95Button>
                   </div>
               </Win95Window>
               <div className="mt-8 text-white text-center opacity-70 text-sm animate-pulse">
                   Tap screen for Full Immersive Mode
               </div>
          </div>
      );
  }

  // 2. SETUP SCREEN
  if (screen === AppScreen.SETUP) {
      return (
        <div className="flex-1 flex flex-col bg-[#008080] p-2 sm:p-4 overflow-y-auto">
             <Win95Window title="Network Config" className="w-full max-w-lg mx-auto h-full sm:h-auto flex flex-col shadow-[8px_8px_0_rgba(0,0,0,0.5)]">
                {/* Tabs */}
                <div className="flex gap-1 p-2 pb-0 bg-[#c0c0c0] shrink-0">
                    <button 
                        onClick={() => setIsHost(true)} 
                        className={`flex-1 px-4 py-2 border-t-2 border-l-2 border-r-2 rounded-t-sm ${isHost ? 'bg-[#c0c0c0] border-white text-black font-bold -mb-[2px] z-10' : 'bg-gray-400 border-gray-600 text-gray-700'}`}
                    >
                        HOST
                    </button>
                    <button 
                        onClick={() => setIsHost(false)}
                        className={`flex-1 px-4 py-2 border-t-2 border-l-2 border-r-2 rounded-t-sm ${!isHost ? 'bg-[#c0c0c0] border-white text-black font-bold -mb-[2px] z-10' : 'bg-gray-400 border-gray-600 text-gray-700'}`}
                    >
                        JOIN
                    </button>
                </div>

                <div className="flex-1 p-4 bg-[#c0c0c0] border-2 border-white border-t-white overflow-y-auto">
                    {/* Error Banner */}
                    {errorMsg && (
                        <div className="bg-red-600 text-white p-2 mb-4 text-center font-bold border-2 border-t-black border-l-black border-b-white border-r-white">
                            ! {errorMsg} !
                        </div>
                    )}

                    {isHost ? (
                        <div className="space-y-6">
                            <div className="bg-yellow-100 border border-black p-2 text-sm text-center">
                                Share these credentials securely.
                            </div>
                            
                            <div className="space-y-1">
                                <label className="font-bold text-sm block">MY ID (ROOM):</label>
                                <div className="flex gap-2">
                                    <Win95Input readOnly value={myPeerId || 'Generating...'} className="bg-gray-200" />
                                    <Win95Button onClick={() => copyToClipboard(myPeerId)} title="Copy"><Copy size={18}/></Win95Button>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="font-bold text-sm block">SECRET KEY:</label>
                                <div className="flex gap-2">
                                    <Win95Input readOnly value={roomKey} className="bg-gray-200" />
                                    <Win95Button onClick={() => copyToClipboard(roomKey)} title="Copy"><Copy size={18}/></Win95Button>
                                </div>
                                <button onClick={() => setRoomKey(generateRandomKey())} className="text-blue-800 underline text-xs w-full text-right mt-1">
                                    Generate New Key
                                </button>
                            </div>
                            
                            <div className="mt-8 flex items-center justify-center gap-2 text-gray-600 animate-pulse">
                                <Wifi size={20}/>
                                <span>Waiting for incoming connection...</span>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <p className="text-sm mb-4">Enter the Host's Room ID and the shared Secret Key.</p>
                            
                            <div className="space-y-1">
                                <label className="font-bold text-sm">TARGET ID:</label>
                                <Win95Input 
                                    value={targetPeerId} 
                                    onChange={(e) => setTargetPeerId(e.target.value)}
                                    placeholder="Paste Host ID here"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="font-bold text-sm">SECRET KEY:</label>
                                <Win95Input 
                                    value={roomKey} 
                                    onChange={(e) => setRoomKey(e.target.value)}
                                    placeholder="Paste Secret Key here"
                                />
                            </div>

                            <Win95Button onClick={connectToPeer} className="w-full mt-6 py-4 text-lg font-bold">
                                CONNECT SYSTEM
                            </Win95Button>
                        </div>
                    )}
                </div>
                
                <div className="p-2 border-t border-white flex justify-between bg-[#c0c0c0] shrink-0">
                    <Win95Button onClick={() => setScreen(AppScreen.LOGIN)} className="flex items-center gap-1">
                        <ArrowLeft size={16}/> Back
                    </Win95Button>
                    <div className="px-2 py-1 border border-gray-500 bg-gray-200 text-xs flex items-center">
                        {status}
                    </div>
                </div>
            </Win95Window>
        </div>
      );
  }

  // 3. CHAT SCREEN (MOBILE APP VIEW)
  return (
    <div className="fixed inset-0 w-full h-full bg-[#c0c0c0] flex flex-col overflow-hidden">
        
        {/* Mobile Header (Fixed Top) */}
        <div className="h-12 bg-[#000080] flex items-center justify-between px-3 shadow-md shrink-0 z-10">
            <div className="flex items-center gap-2 text-white font-bold text-lg truncate">
                <Terminal size={18} />
                <span>{isHost ? 'HOST_TERM' : 'GUEST_TERM'}</span>
            </div>
            <div className="flex items-center gap-3">
                {status === 'Connected' ? <Wifi size={18} className="text-green-400"/> : <WifiOff size={18} className="text-red-400"/>}
                <button 
                    onClick={() => {
                        if(confirm("Terminate session?")) {
                            window.location.reload();
                        }
                    }}
                    className="w-8 h-8 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-black border-r-black flex items-center justify-center active:border-t-black active:border-l-black active:border-b-white active:border-r-white"
                >
                    <LogOut size={16} className="text-black" />
                </button>
            </div>
        </div>
        
        {/* Messages Area (Flexible Scroll) */}
        <div className="flex-1 overflow-y-auto bg-white p-2 w-full">
            {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-300 opacity-60">
                    <ShieldCheck size={64} strokeWidth={1} />
                    <p className="mt-4 text-2xl font-bold tracking-widest">SECURE</p>
                    <p className="text-sm">END-TO-END ENCRYPTED</p>
                </div>
            )}
            
            {messages.map((msg) => (
                <div 
                    key={msg.id} 
                    className={`mb-4 flex flex-col ${msg.sender === username ? 'items-end' : 'items-start'}`}
                >
                    {msg.isSystem ? (
                        <div className="w-full flex justify-center my-2">
                            <span className="bg-yellow-100 text-black px-3 py-1 text-xs border border-black shadow-[2px_2px_0_#000]">
                                SYSTEM: {msg.content}
                            </span>
                        </div>
                    ) : (
                        <div className={`max-w-[85%] flex flex-col ${msg.sender === username ? 'items-end' : 'items-start'}`}>
                            <div className="flex items-baseline gap-2 mb-1 px-1">
                                <span className={`font-bold text-xs uppercase ${msg.sender === username ? 'text-blue-800' : 'text-purple-800'}`}>
                                    {msg.sender === username ? 'ME' : msg.sender}
                                </span>
                            </div>
                            <div 
                                className={`
                                    px-4 py-3 text-lg border-2 shadow-[4px_4px_0_rgba(0,0,0,0.2)] break-words w-full
                                    ${msg.sender === username 
                                        ? 'bg-[#000080] text-white border-t-blue-400 border-l-blue-400 border-b-black border-r-black' 
                                        : 'bg-[#c0c0c0] text-black border-t-white border-l-white border-b-black border-r-black'
                                    }
                                `}
                            >
                                {msg.content}
                            </div>
                            <span className="text-[10px] text-gray-400 mt-1 px-1">
                                {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </span>
                        </div>
                    )}
                </div>
            ))}
            <div ref={messagesEndRef} className="h-2" />
        </div>

        {/* Input Area (Fixed Bottom) */}
        <div className="bg-[#c0c0c0] p-2 border-t-2 border-white shrink-0 z-10 pb-safe">
            <div className="flex gap-2 items-end">
                <Win95Input 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="Message..."
                    className="flex-1 min-h-[50px] text-xl !text-black border-2 border-t-black border-l-black border-b-white border-r-white" 
                    autoComplete="off"
                />
                <Win95Button onClick={sendMessage} className="h-[50px] w-14 flex items-center justify-center bg-blue-100 active:bg-blue-200 mb-[2px]">
                    <Send size={24} className="text-black"/>
                </Win95Button>
            </div>
        </div>
        
        {/* Windows 95 Taskbar (Visual Only) */}
        <div className="h-8 bg-[#c0c0c0] border-t-2 border-white flex items-center px-2 shrink-0 select-none pb-safe-bottom">
            <div className="border-2 border-t-white border-l-white border-b-black border-r-black px-2 py-0.5 flex items-center gap-1 active:border-t-black active:border-l-black active:border-b-white active:border-r-white cursor-pointer mr-2">
                <img src="https://win98icons.alexmeub.com/icons/png/windows_slanted-1.png" className="w-4 h-4" alt="start" />
                <span className="italic font-black text-sm">Start</span>
            </div>
            <div className="w-[2px] h-5 bg-gray-400 shadow-[1px_0_white] mr-2"></div>
            <div className="flex-1 bg-black/10 border border-b-white border-r-white border-t-black border-l-black px-2 py-0.5 truncate text-xs text-white bg-[#000080]">
                 {targetPeerId ? `Connected: ${targetPeerId.substring(0,8)}...` : 'RetroChat 95'}
            </div>
            <div className="w-[2px] h-5 bg-gray-400 shadow-[1px_0_white] mx-2"></div>
            <div className="border-2 border-t-gray-600 border-l-gray-600 border-b-white border-r-white px-2 bg-[#c0c0c0] text-xs">
                {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </div>
        </div>
    </div>
  );
};

export default App;