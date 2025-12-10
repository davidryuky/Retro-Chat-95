
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DataConnection } from 'peerjs';
import { Send, Copy, LogOut, Terminal, ShieldCheck, User, ArrowLeft, Wifi, WifiOff, AlertTriangle, Link as LinkIcon, Share2 } from 'lucide-react';
import { Win95Window, Win95Button, Win95Input, Win95Panel } from './components/RetroUI';
import { encryptMessage, decryptMessage, generateRandomName, generateSessionCode, parseSessionCode } from './utils/crypto';
import { Message, AppScreen, NetworkMessage } from './types';

const App: React.FC = () => {
  // --- State ---
  const [screen, setScreen] = useState<AppScreen>(AppScreen.LOGIN);
  const [username, setUsername] = useState<string>('');
  
  // Connection Setup
  const [isHost, setIsHost] = useState<boolean>(true);
  const [sessionCode, setSessionCode] = useState<string>(''); // The 12-char code
  const [joinCodeInput, setJoinCodeInput] = useState<string>(''); // For joining user
  const [roomKey, setRoomKey] = useState<string>('');
  
  const [status, setStatus] = useState<string>('Offline');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Auto-join handling
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>('');

  // --- Refs ---
  const peerRef = useRef<any>(null);
  const connRef = useRef<DataConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const reconnectTimeoutRef = useRef<any>(null);

  // --- Effects ---

  // Check for URL parameters on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (joinCode) {
        setPendingJoinCode(joinCode);
        console.log("Auto-join code detected");
    }
  }, []);

  // Fullscreen trigger
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

  // Cleanup on unmount
  useEffect(() => {
      return () => {
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          if (connRef.current) connRef.current.close();
          if (peerRef.current) peerRef.current.destroy();
      };
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    if (screen === AppScreen.CHAT) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, screen]);

  // --- Handlers ---

  const initHostSession = async () => {
      // 1. Generate a new code
      const newCode = generateSessionCode();
      const parsed = parseSessionCode(newCode);
      
      if (!parsed) {
          setErrorMsg("Error generating secure code.");
          return;
      }

      setSessionCode(parsed.rawCode);
      setRoomKey(parsed.key);
      setStatus('Initializing...');
      setErrorMsg(null);

      // 2. Initialize Peer with the specific ID from the code
      await initializePeer(parsed.peerId);
  };

  const initializePeer = async (customId?: string) => {
      // Cleanup old peer if exists
      if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
      }

      try {
            const peerModule = await import('peerjs');
            const PeerCtor = peerModule.Peer || (peerModule as any).default || (window as any).Peer;
            
            if (!PeerCtor) throw new Error("PeerJS library error.");

            // Standard STUN servers to prevent connection drops
            const peerOptions: any = { 
                debug: 1,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ]
                }
            };
            
            // If we are host, we MUST use the custom ID derived from our code
            const peer = customId 
                ? new PeerCtor(customId, peerOptions) 
                : new PeerCtor(undefined, peerOptions);

            peer.on('open', (id: string) => {
                console.log('My Peer ID:', id);
                setStatus('Online');
                setErrorMsg(null); // Clear errors on success
                if (customId) {
                    setStatus('Waiting for Peer...');
                }
            });

            peer.on('connection', (conn: DataConnection) => {
                console.log('Incoming connection:', conn.peer);
                // Only accept one connection for this P2P chat (simplicity)
                if (connRef.current && connRef.current.open) {
                    conn.close(); // Busy
                    return;
                }
                setupConnectionListeners(conn);
            });

            peer.on('error', (err: any) => {
                console.error('Peer error:', err);
                const type = err.type;

                if (type === 'unavailable-id') {
                    // ID collision. If host, try next code.
                    if (isHost) {
                        setErrorMsg("ID collision. Retrying...");
                        setTimeout(initHostSession, 1000);
                    } else {
                        setErrorMsg("ID unavailable. Please retry.");
                    }
                } else if (type === 'peer-unavailable') {
                    setErrorMsg("Session not found. Check code.");
                    setStatus("Error");
                } else if (type === 'network' || type === 'server-error' || err.message === 'Lost connection to server') {
                    // Critical: Signaling server lost. Try to reconnect if not destroyed.
                    if (peer && !peer.destroyed) {
                        console.log("Connection lost, attempting reconnect...");
                        setStatus("Reconnecting...");
                        // Debounce reconnect
                        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                        reconnectTimeoutRef.current = setTimeout(() => {
                            peer.reconnect();
                        }, 2000);
                    }
                } else {
                    // Don't show generic errors if we are just reconnecting
                    if (status !== 'Reconnecting...') {
                        setErrorMsg(`Net Error: ${type || 'Unknown'}`);
                    }
                }
            });

            peer.on('disconnected', () => {
                console.log("Peer disconnected from server.");
                // If we have an active chat, this is fine, we just can't make NEW connections.
                // But we should try to reconnect to signaling server to be safe.
                if (peer && !peer.destroyed) {
                    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = setTimeout(() => {
                         peer.reconnect();
                    }, 2000);
                }
            });

            peerRef.current = peer;

      } catch (e: any) {
          console.error(e);
          setErrorMsg(`Failed to start network: ${e.message}`);
      }
  };

  const joinSession = async () => {
      const codeToUse = pendingJoinCode || joinCodeInput;
      if (!codeToUse) return;

      const parsed = parseSessionCode(codeToUse);
      if (!parsed) {
          setErrorMsg("Invalid Code Format.");
          return;
      }

      setSessionCode(parsed.rawCode);
      setRoomKey(parsed.key);
      setErrorMsg(null);
      setStatus('Connecting...');

      // Initialize my own peer (random ID is fine for guest)
      if (!peerRef.current || peerRef.current.destroyed) {
          await initializePeer();
          // Wait a moment for open
          await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (peerRef.current) {
          try {
            const conn = peerRef.current.connect(parsed.peerId, { reliable: true });
            if (!conn) {
                setErrorMsg("Connection failed to start.");
                return;
            }
            setupConnectionListeners(conn);
          } catch(e) {
              setErrorMsg("Connection Error.");
          }
      }
  };

  const setupConnectionListeners = (conn: DataConnection) => {
      connRef.current = conn;
      
      conn.on('open', () => {
          setStatus('Connected');
          setScreen(AppScreen.CHAT);
          setErrorMsg(null);
      });

      conn.on('data', async (data: any) => {
          const msg = data as NetworkMessage;
          if (msg.type === 'CHAT' && msg.payload && msg.sender) {
              try {
                  const text = await decryptMessage(msg.payload, roomKeyRef.current);
                  addMessage(msg.sender, text);
              } catch (e) {
                  addSystemMessage(`Could not decrypt message from ${msg.sender}.`);
              }
          }
      });
      
      conn.on('close', () => {
          setStatus('Disconnected');
          addSystemMessage('Peer disconnected.');
          connRef.current = null;
      });
      
      conn.on('error', (err) => {
          console.error("Conn error", err);
          addSystemMessage("Connection error.");
      });
  };

  // Keep ref updated for callbacks
  const roomKeyRef = useRef(roomKey);
  useEffect(() => { roomKeyRef.current = roomKey; }, [roomKey]);


  const sendMessage = async () => {
      if (!inputText.trim()) return;
      
      const textToSend = inputText;
      setInputText('');
      addMessage(username, textToSend);

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
              addSystemMessage("Encryption failed.");
          }
      } else {
          addSystemMessage("Not connected.");
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
      if (!username) setUsername(generateRandomName());
      
      // If pending join, go straight to join logic
      if (pendingJoinCode) {
          setIsHost(false);
          setScreen(AppScreen.SETUP);
          // Trigger join slightly after render to ensure state is set
          setTimeout(joinSession, 100); 
      } else {
          setScreen(AppScreen.SETUP);
          // If default host, init session immediately
          if (isHost) {
              initHostSession();
          }
      }
  };

  // Reset/Switch modes
  const switchMode = (host: boolean) => {
      setIsHost(host);
      if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
      }
      setSessionCode('');
      setJoinCodeInput('');
      setStatus('Offline');
      setErrorMsg(null);
      
      if (host) {
          // Small timeout to allow destroy to complete
          setTimeout(initHostSession, 100);
      }
  };

  const copyToClipboard = async (text: string) => {
      try {
          await navigator.clipboard.writeText(text);
          alert("Copied!");
      } catch(e) {}
  };

  const getShareLink = () => {
      return `${window.location.origin}${window.location.pathname}?join=${sessionCode}`;
  };

  // --- RENDER ---

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
                           {pendingJoinCode && (
                               <p className="text-xs text-blue-800 mt-2 font-bold animate-pulse">
                                   >> INVITE RECEIVED
                               </p>
                           )}
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
                           {pendingJoinCode ? 'JOIN CHANNEL' : 'INITIALIZE'}
                       </Win95Button>
                   </div>
               </Win95Window>
          </div>
      );
  }

  if (screen === AppScreen.SETUP) {
      return (
        <div className="flex-1 flex flex-col bg-[#008080] p-2 sm:p-4 overflow-y-auto">
             <Win95Window title="Network Config" className="w-full max-w-lg mx-auto h-full sm:h-auto flex flex-col shadow-[8px_8px_0_rgba(0,0,0,0.5)]">
                {/* Tabs */}
                <div className="flex gap-1 p-2 pb-0 bg-[#c0c0c0] shrink-0">
                    <button 
                        onClick={() => switchMode(true)} 
                        className={`flex-1 px-4 py-2 border-t-2 border-l-2 border-r-2 rounded-t-sm ${isHost ? 'bg-[#c0c0c0] border-white text-black font-bold -mb-[2px] z-10' : 'bg-gray-400 border-gray-600 text-gray-700'}`}
                    >
                        HOST
                    </button>
                    <button 
                        onClick={() => switchMode(false)}
                        className={`flex-1 px-4 py-2 border-t-2 border-l-2 border-r-2 rounded-t-sm ${!isHost ? 'bg-[#c0c0c0] border-white text-black font-bold -mb-[2px] z-10' : 'bg-gray-400 border-gray-600 text-gray-700'}`}
                    >
                        JOIN
                    </button>
                </div>

                <div className="flex-1 p-4 bg-[#c0c0c0] border-2 border-white border-t-white overflow-y-auto">
                    {errorMsg && (
                        <div className="bg-red-600 text-white p-2 mb-4 text-center font-bold border-2 border-t-black border-l-black border-b-white border-r-white">
                            ! {errorMsg} !
                        </div>
                    )}

                    {isHost ? (
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="font-bold text-sm block">SESSION CODE:</label>
                                <div className="bg-white border-2 border-t-black border-l-black border-b-white border-r-white p-4 text-2xl text-center tracking-widest font-mono select-all">
                                    {sessionCode || '...'}
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                     <Win95Button onClick={() => copyToClipboard(sessionCode)} className="flex items-center justify-center gap-2">
                                        <Copy size={16}/> Copy Code
                                     </Win95Button>
                                     <Win95Button onClick={() => copyToClipboard(getShareLink())} className="flex items-center justify-center gap-2">
                                        <LinkIcon size={16}/> Copy Link
                                     </Win95Button>
                                     
                                     {navigator.share && (
                                         <Win95Button onClick={() => navigator.share({title: 'RetroChat', url: getShareLink()})} className="col-span-2 flex items-center justify-center gap-2">
                                            <Share2 size={16}/> Share Invite
                                         </Win95Button>
                                     )}
                                </div>
                            </div>
                            
                            <div className="mt-8 flex flex-col items-center justify-center gap-2 text-gray-600 animate-pulse">
                                <Wifi size={32}/>
                                <span className="font-bold">{status}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <p className="text-sm mb-4">Enter the code from the Host:</p>
                            
                            <div className="space-y-1">
                                <label className="font-bold text-sm">SESSION CODE:</label>
                                <Win95Input 
                                    value={joinCodeInput} 
                                    onChange={(e) => setJoinCodeInput(e.target.value)}
                                    placeholder="Ex: aB3d9Z..."
                                    className="text-center text-xl tracking-widest"
                                />
                            </div>

                            <Win95Button onClick={joinSession} className="w-full mt-6 py-4 text-lg font-bold">
                                {status === 'Connecting...' ? 'CONNECTING...' : 'ESTABLISH LINK'}
                            </Win95Button>
                        </div>
                    )}
                </div>
                
                <div className="p-2 border-t border-white flex justify-between bg-[#c0c0c0] shrink-0">
                    <Win95Button onClick={() => setScreen(AppScreen.LOGIN)} className="flex items-center gap-1">
                        <ArrowLeft size={16}/> Back
                    </Win95Button>
                </div>
            </Win95Window>
        </div>
      );
  }

  // 3. CHAT SCREEN
  return (
    <div className="fixed inset-0 w-full h-full bg-[#c0c0c0] flex flex-col overflow-hidden">
        <div className="h-12 bg-[#000080] flex items-center justify-between px-3 shadow-md shrink-0 z-10">
            <div className="flex items-center gap-2 text-white font-bold text-lg truncate">
                <Terminal size={18} />
                <span>CHAT_{sessionCode.substring(0,6)}</span>
            </div>
            <div className="flex items-center gap-3">
                {status === 'Connected' ? <Wifi size={18} className="text-green-400"/> : <WifiOff size={18} className="text-red-400"/>}
                <button 
                    onClick={() => {
                       window.location.reload();
                    }}
                    className="w-8 h-8 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-black border-r-black flex items-center justify-center"
                >
                    <LogOut size={16} className="text-black" />
                </button>
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto bg-white p-2 w-full">
             {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-300 opacity-60">
                    <ShieldCheck size={64} strokeWidth={1} />
                    <p className="mt-4 text-2xl font-bold tracking-widest">SECURE</p>
                    <p className="text-xs mt-2">WAITING FOR MESSAGES...</p>
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
                                {msg.content}
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
        
        {/* Taskbar */}
        <div className="h-8 bg-[#c0c0c0] border-t-2 border-white flex items-center px-2 shrink-0 select-none pb-safe-bottom">
            <div className="border-2 border-t-white border-l-white border-b-black border-r-black px-2 py-0.5 flex items-center gap-1 active:border-t-black active:border-l-black active:border-b-white active:border-r-white cursor-pointer mr-2">
                <img src="https://win98icons.alexmeub.com/icons/png/windows_slanted-1.png" className="w-4 h-4" alt="start" />
                <span className="italic font-black text-sm">Start</span>
            </div>
            <div className="w-[2px] h-5 bg-gray-400 shadow-[1px_0_white] mr-2"></div>
            <div className="flex-1 bg-black/10 border border-b-white border-r-white border-t-black border-l-black px-2 py-0.5 truncate text-xs text-white bg-[#000080]">
                 RetroChat
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
