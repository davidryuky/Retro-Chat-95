import React, { useState, useEffect, useRef } from 'react';
import { Peer, DataConnection } from 'peerjs';
import { Send, Copy, LogOut, Terminal, ShieldCheck, User, ArrowLeft, Wifi, WifiOff, AlertTriangle, Link as LinkIcon, Share2, Maximize2, Activity, Lock, Globe, Monitor, Info, Power, HelpCircle } from 'lucide-react';
import { Win95Window, Win95Button, Win95Input, Win95Panel } from './components/RetroUI';
import { encryptMessage, decryptMessage, generateRandomName, generateSessionCode, parseSessionCode } from './utils/crypto';
import { Message, AppScreen, NetworkMessage } from './types';

const App: React.FC = () => {
  // --- State ---
  const [screen, setScreen] = useState<AppScreen>(AppScreen.LOGIN);
  const [username, setUsername] = useState<string>('');
  
  // UI States
  const [isStartMenuOpen, setIsStartMenuOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);

  // Connection Setup
  const [isHost, setIsHost] = useState<boolean>(true);
  const [sessionCode, setSessionCode] = useState<string>(''); 
  const [joinCodeInput, setJoinCodeInput] = useState<string>(''); 
  const [roomKey, setRoomKey] = useState<string>('');
  
  const [status, setStatus] = useState<string>('Offline');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Auto-join handling
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);

  // Chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isRemoteTyping, setIsRemoteTyping] = useState<boolean>(false);

  // --- Refs ---
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const typingSendTimeoutRef = useRef<any>(null);
  const typingReceiveTimeoutRef = useRef<any>(null);
  
  // Refs for closures
  const usernameRef = useRef<string>('');
  const roomKeyRef = useRef<string>('');
  const messagesRef = useRef<Message[]>([]); // To access messages in event listeners

  // --- Effects ---

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (joinCode) {
        setPendingJoinCode(joinCode);
    }
  }, []);

  useEffect(() => { usernameRef.current = username; }, [username]);
  useEffect(() => { roomKeyRef.current = roomKey; }, [roomKey]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
      return () => {
         destroyConnection();
      };
  }, []);

  useEffect(() => {
    if (screen === AppScreen.CHAT) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, screen, isRemoteTyping]);

  useEffect(() => {
    if (screen === AppScreen.CHAT && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
  }, [screen]);

  // Handle visibility change to mark messages as read when user comes back
  useEffect(() => {
      const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible' && screen === AppScreen.CHAT) {
              const incoming = messagesRef.current.filter(m => m.sender !== usernameRef.current && !m.isSystem);
              incoming.slice(-5).forEach(msg => {
                  sendReadReceipt(msg.id);
              });
          }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => {
          document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
  }, [screen]);

  // --- Helper: Cleanup ---
  const destroyConnection = () => {
      if (connRef.current) {
          connRef.current.close();
          connRef.current = null;
      }
      if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
      }
      setIsRemoteTyping(false);
  };

  // --- Helper: Handle Incoming Data ---
  const handleData = async (data: any) => {
      try {
          const msg = typeof data === 'string' ? JSON.parse(data) : data as NetworkMessage;
          
          // 1. Handle Typing
          if (msg.type === 'TYPING') {
              handleRemoteTyping();
              return;
          }

          // 2. Handle Read Receipt (Sender side logic)
          if (msg.type === 'READ_RECEIPT' && msg.messageId) {
              setMessages(prev => prev.map(m => 
                  m.id === msg.messageId ? { ...m, status: 'read' } : m
              ));
              return;
          }

          // 3. Handle Chat Message (Receiver side logic)
          if (msg.type === 'CHAT' && msg.payload) {
              const decryptedText = await decryptMessage(msg.payload, roomKeyRef.current);
              
              const msgId = msg.messageId || Date.now().toString();

              addMessage(msg.sender || 'Unknown', decryptedText, false, msgId);
              sendNotification(msg.sender || 'User', decryptedText);

              // Send Read Receipt if visible
              if (document.visibilityState === 'visible') {
                  sendReadReceipt(msgId);
              }
          }

          // 4. Handle System Message
          if (msg.type === 'SYSTEM' && msg.payload) {
              const statusText = await decryptMessage(msg.payload, roomKeyRef.current);
              addSystemMessage(statusText);
          }

      } catch (e) {
          console.error("Data parse error", e);
      }
  };

  // --- Handlers: Host ---

  const initHostSession = async () => {
      destroyConnection(); // Clean slate

      const newCode = generateSessionCode();
      const parsed = parseSessionCode(newCode);
      if (!parsed) return;

      setSessionCode(parsed.rawCode);
      setRoomKey(parsed.key);
      setErrorMsg(null);
      setIsHost(true);
      setStatus('Initializing Node...');

      const myPeerId = `rc95-v1-${parsed.rawCode}`;

      const peer = new Peer(myPeerId, {
          debug: 1,
          config: {
              iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:global.stun.twilio.com:3478' }
              ]
          }
      });

      peerRef.current = peer;

      peer.on('open', (id) => {
          setStatus('Waiting for Peer...');
      });

      peer.on('connection', (conn) => {
          connRef.current = conn;
          setStatus('Negotiating...');

          conn.on('open', () => {
              setStatus('Connected');
              setScreen(AppScreen.CHAT);
              sendSystemMessage("Secure Connection Established.");
          });

          conn.on('data', (data) => handleData(data));
          
          conn.on('close', () => {
              addSystemMessage("Peer disconnected.");
              setStatus('Peer Left');
          });
          
          conn.on('error', () => {
               addSystemMessage("Connection Error.");
          });
      });

      peer.on('error', (err) => {
          if (err.type === 'unavailable-id') {
              setErrorMsg("Session Code Collision. Retry.");
          } else {
              setErrorMsg("Network Error: " + err.type);
          }
          setStatus("Error");
      });
  };

  // --- Handlers: Join ---

  const joinSession = async () => {
      const codeToUse = pendingJoinCode || joinCodeInput;
      if (!codeToUse) return;

      const parsed = parseSessionCode(codeToUse);
      if (!parsed) {
          setErrorMsg("Invalid Code.");
          return;
      }

      destroyConnection();

      setSessionCode(parsed.rawCode);
      setRoomKey(parsed.key);
      setErrorMsg(null);
      setIsHost(false);
      setStatus('Locating Host...');

      const peer = new Peer({
          debug: 1,
           config: {
              iceServers: [
                  { urls: 'stun:stun.l.google.com:19302' },
                  { urls: 'stun:global.stun.twilio.com:3478' }
              ]
          }
      });
      peerRef.current = peer;

      peer.on('open', (id) => {
          setStatus('Dialing...');
          const hostId = `rc95-v1-${parsed.rawCode}`;
          const conn = peer.connect(hostId, { reliable: true });
          connRef.current = conn;

          conn.on('open', () => {
              setStatus('Connected');
              setScreen(AppScreen.CHAT);
              setTimeout(() => {
                   sendSystemMessage("USER_JOINED");
              }, 500);
          });

          conn.on('data', (data) => handleData(data));

          conn.on('close', () => {
               addSystemMessage("Host disconnected.");
               setStatus('Disconnected');
          });
          
          conn.on('error', (err) => {
              setErrorMsg("Connection Failed");
              setStatus("Error");
          });
      });

      peer.on('error', (err) => {
          setErrorMsg("Could not reach network.");
          setStatus("Error");
      });
  };

  // --- Shared Actions ---

  const handleRemoteTyping = () => {
      setIsRemoteTyping(true);
      if (typingReceiveTimeoutRef.current) clearTimeout(typingReceiveTimeoutRef.current);
      typingReceiveTimeoutRef.current = setTimeout(() => {
          setIsRemoteTyping(false);
      }, 3000);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputText(e.target.value);
      if (e.target.value.length > 0 && connRef.current?.open) {
          if (!typingSendTimeoutRef.current) {
              const msg: NetworkMessage = { type: 'TYPING', sender: usernameRef.current };
              connRef.current.send(JSON.stringify(msg));
              typingSendTimeoutRef.current = setTimeout(() => {
                  typingSendTimeoutRef.current = null;
              }, 1000);
          }
      }
  };

  const sendReadReceipt = (msgId: string) => {
      if (connRef.current && connRef.current.open) {
          const msg: NetworkMessage = {
              type: 'READ_RECEIPT',
              sender: usernameRef.current,
              messageId: msgId
          };
          connRef.current.send(JSON.stringify(msg));
      }
  };

  const sendSystemMessage = async (text: string) => {
      if (connRef.current && connRef.current.open) {
          try {
            const encrypted = await encryptMessage(text, roomKeyRef.current);
            const msg: NetworkMessage = {
                type: 'SYSTEM',
                sender: 'SYSTEM',
                payload: encrypted
            };
            connRef.current.send(JSON.stringify(msg));
          } catch(e) {}
      }
  };

  const sendMessage = async () => {
      if (!inputText.trim()) return;
      const text = inputText;
      setInputText('');
      
      const newMsgId = Date.now().toString() + Math.random().toString().slice(2, 6);
      
      // Add local message with 'sent' status
      addMessage(username, text, false, newMsgId);

      if (connRef.current && connRef.current.open) {
          try {
              const encrypted = await encryptMessage(text, roomKeyRef.current);
              const msg: NetworkMessage = {
                  type: 'CHAT',
                  sender: username,
                  payload: encrypted,
                  messageId: newMsgId 
              };
              connRef.current.send(JSON.stringify(msg));
          } catch (e) {
              addSystemMessage("Encryption Error");
          }
      } else {
          addSystemMessage("Not connected.");
      }
  };

  const addMessage = (sender: string, content: string, isSystem = false, idOverride?: string) => {
      setMessages(prev => [...prev, {
          id: idOverride || (Date.now().toString() + Math.random()),
          sender,
          content,
          timestamp: Date.now(),
          isSystem,
          status: 'sent' // Default status
      }]);
  };

  const addSystemMessage = (content: string) => {
      addMessage('SYSTEM', content, true);
  };

  const sendNotification = async (sender: string, text: string) => {
      if (document.visibilityState === 'visible') return; 
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;

      const title = `New Message from ${sender}`;
      const body = text.length > 50 ? text.substring(0, 50) + '...' : text;
      
      try {
          const icon = 'https://win98icons.alexmeub.com/icons/png/computer_explorer-5.png';
          if (navigator.serviceWorker && navigator.serviceWorker.ready) {
              const reg = await navigator.serviceWorker.ready;
              reg.showNotification(title, { body, icon, tag: 'retro-chat-msg', vibrate: [200] } as any);
          } else {
              new Notification(title, { body, icon });
          }
      } catch (e) {}
  };

  // --- UI Helpers ---
  const handleLogin = () => {
      if (!username) setUsername(generateRandomName());
      if (pendingJoinCode) {
          setIsHost(false);
          setScreen(AppScreen.SETUP);
          setTimeout(joinSession, 100); 
      } else {
          setScreen(AppScreen.SETUP);
          if (isHost) {
              initHostSession();
          }
      }
  };

  const switchMode = (host: boolean) => {
      setIsHost(host);
      destroyConnection();
      setSessionCode('');
      setJoinCodeInput('');
      setStatus('Offline');
      setErrorMsg(null);
      
      if (host) {
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

  const toggleFullscreen = () => {
     if (!document.fullscreenElement) {
         document.documentElement.requestFullscreen().catch(() => {});
     } else {
         document.exitFullscreen().catch(() => {});
     }
     setIsStartMenuOpen(false);
  };

  // --- RENDER ---

  // RENDER: About Window
  const renderAboutWindow = () => {
      if (!showAbout) return null;
      return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <Win95Window 
                title="About RetroChat 95" 
                className="w-full max-w-sm shadow-xl"
                onClose={() => setShowAbout(false)}
                icon={<Info size={16} className="text-white"/>}
              >
                  <div className="p-4 bg-[#c0c0c0] flex flex-col gap-4 text-center">
                       <div className="flex justify-center items-center gap-4">
                           <ShieldCheck size={48} className="text-[#000080]" />
                           <div className="text-left">
                                <h2 className="font-bold text-xl">RetroChat 95</h2>
                                <p className="text-xs text-gray-600">Version 1.0 (Build 95)</p>
                           </div>
                       </div>
                       
                       <div className="border-2 border-t-black border-l-black border-b-white border-r-white p-4 bg-white text-left text-sm font-mono leading-tight">
                           <p className="mb-4">
                               A nostalgic journey back to 1995, featuring secure peer-to-peer encryption for private conversations.
                           </p>
                           
                           <p className="mb-1 text-gray-600">Developed by:</p>
                           <a href="https://www.davi.design" target="_blank" rel="noopener noreferrer" className="text-blue-800 font-bold underline cursor-pointer hover:bg-blue-800 hover:text-white">
                               www.davi.design
                           </a>
                       </div>
                       
                       <div className="flex justify-center">
                            <Win95Button onClick={() => setShowAbout(false)} className="w-24">OK</Win95Button>
                       </div>
                  </div>
              </Win95Window>
          </div>
      );
  };

  if (screen === AppScreen.LOGIN) {
      return (
          <div className="flex-1 flex flex-col items-center justify-center p-4 bg-[#008080]">
               {renderAboutWindow()}
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
                                   &gt;&gt; INVITE RECEIVED
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
        <div className="flex-1 flex flex-col items-center justify-center bg-[#008080] p-4">
             {renderAboutWindow()}
             <Win95Window title="Network Config" className="w-full max-w-lg shadow-[8px_8px_0_rgba(0,0,0,0.5)] flex flex-col max-h-full">
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
                            
                            <div className="mt-8 flex flex-col items-center justify-center gap-2 text-gray-600">
                                <Globe size={32} className={status.includes('Init') || status.includes('Wait') ? "animate-spin" : ""}/>
                                <span className="font-bold">{status}</span>
                                {status === 'Waiting for Peer...' && <span className="text-xs text-blue-800 font-bold animate-pulse mt-2">Ready. Waiting for client...</span>}
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
                                {status.includes('Locating') || status.includes('Dialing') ? 'CONNECTING...' : 'ESTABLISH LINK'}
                            </Win95Button>
                            
                            {(status.includes('Locating') || status.includes('Dialing')) && (
                                <div className="mt-4 flex flex-col items-center justify-center text-xs text-gray-500 animate-pulse">
                                    <Globe size={24} className="mb-1 animate-spin"/>
                                    Scanning frequencies...
                                </div>
                            )}
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
        {/* Transparent backdrop to close start menu when clicking outside */}
        {isStartMenuOpen && (
            <div className="fixed inset-0 z-20 bg-transparent" onClick={() => setIsStartMenuOpen(false)}></div>
        )}
        
        {renderAboutWindow()}

        <div className="h-12 bg-[#000080] flex items-center justify-between px-3 shadow-md shrink-0 z-10">
            <div className="flex items-center gap-2 text-white font-bold text-lg truncate">
                <Terminal size={18} />
                <span>CHAT_{sessionCode.substring(0,6)}</span>
            </div>
            <div className="flex items-center gap-3">
                {status === 'Connected' ? <Wifi size={18} className="text-green-400"/> : <WifiOff size={18} className="text-red-400"/>}
                
                <button 
                    onClick={toggleFullscreen}
                    className="w-8 h-8 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-black border-r-black flex items-center justify-center active:border-t-black active:border-l-black active:border-b-white active:border-r-white"
                >
                    <Maximize2 size={16} className="text-black" />
                </button>
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto bg-white p-2 w-full">
             {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-300 opacity-60">
                    <ShieldCheck size={64} strokeWidth={1} />
                    <p className="mt-4 text-2xl font-bold tracking-widest">SECURE LINK</p>
                    <p className="text-xs mt-2">DIRECT P2P ENCRYPTION</p>
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
                            <div className="flex items-center gap-1 mt-1 px-1 opacity-60 select-none justify-end w-full">
                                <span className="text-[10px] text-gray-400">
                                    {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </span>
                                
                                {msg.sender === username && (
                                    <span className={`ml-1 font-bold text-[10px] tracking-tighter ${msg.status === 'read' ? 'text-green-600' : 'text-gray-400'}`}>
                                        {msg.status === 'read' ? 'vv' : 'v'}
                                    </span>
                                )}

                                {msg.sender !== username && <Lock size={10} className="text-gray-400" />}
                            </div>
                        </div>
                    )}
                </div>
            ))}
            {isRemoteTyping && <div className="h-6"></div>}
            
            <div ref={messagesEndRef} className="h-2" />
        </div>

        {/* Typing Indicator Status Bar */}
        {isRemoteTyping && (
             <div className="bg-[#c0c0c0] px-2 py-1 text-xs font-bold text-blue-800 border-t-2 border-white animate-pulse flex items-center gap-2">
                 <Activity size={12} />
                 &gt; REMOTE USER IS TYPING...
             </div>
        )}

        <div className="bg-[#c0c0c0] p-2 border-t-2 border-white shrink-0 z-10 pb-safe">
            <div className="flex gap-2 items-end">
                <Win95Input 
                    value={inputText}
                    onChange={handleInputChange}
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
        
        {/* START MENU POPUP */}
        {isStartMenuOpen && (
            <div className="absolute bottom-9 left-1 z-50 flex shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
                 {/* Blue Branding Strip */}
                 <div className="bg-[#000080] w-8 flex items-end pb-2 justify-center border-2 border-t-white border-l-white border-b-black border-r-black">
                     <span className="text-white font-bold text-lg whitespace-nowrap -rotate-90 tracking-widest origin-bottom translate-y-[-10px]">
                         RetroChat 95
                     </span>
                 </div>
                 
                 {/* Menu Items */}
                 <div className="bg-[#c0c0c0] border-2 border-t-white border-b-black border-r-black border-l-0 p-1 flex flex-col min-w-[160px]">
                     <button onClick={() => { setIsStartMenuOpen(false); setShowAbout(true); }} className="flex items-center gap-2 px-2 py-2 hover:bg-[#000080] hover:text-white group text-left">
                         <HelpCircle size={20} className="text-[#000080] group-hover:text-white" />
                         <span className="text-sm font-bold">About RetroChat</span>
                     </button>
                     
                     <button onClick={toggleFullscreen} className="flex items-center gap-2 px-2 py-2 hover:bg-[#000080] hover:text-white group text-left">
                         <Monitor size={20} className="text-black group-hover:text-white" />
                         <span className="text-sm">Fullscreen</span>
                     </button>

                     {sessionCode && (
                        <button onClick={() => { setIsStartMenuOpen(false); copyToClipboard(getShareLink()); }} className="flex items-center gap-2 px-2 py-2 hover:bg-[#000080] hover:text-white group text-left">
                            <Share2 size={20} className="text-black group-hover:text-white" />
                            <span className="text-sm">Copy Invite</span>
                        </button>
                     )}

                     <div className="h-[2px] bg-white border-b border-gray-500 my-1 mx-1"></div>
                     
                     <button onClick={() => window.location.reload()} className="flex items-center gap-2 px-2 py-2 hover:bg-[#000080] hover:text-white group text-left">
                         <Power size={20} className="text-black group-hover:text-white" />
                         <span className="text-sm">Shut Down...</span>
                     </button>
                 </div>
            </div>
        )}

        {/* Taskbar */}
        <div className="h-8 bg-[#c0c0c0] border-t-2 border-white flex items-center px-2 shrink-0 select-none pb-safe-bottom z-30">
            <button 
                onClick={() => setIsStartMenuOpen(!isStartMenuOpen)}
                className={`
                    border-2 px-2 py-0.5 flex items-center gap-1 cursor-pointer mr-2
                    ${isStartMenuOpen 
                        ? 'border-t-black border-l-black border-b-white border-r-white bg-gray-300' 
                        : 'border-t-white border-l-white border-b-black border-r-black hover:active:border-t-black hover:active:border-l-black hover:active:border-b-white hover:active:border-r-white'
                    }
                `}
            >
                <img src="https://win98icons.alexmeub.com/icons/png/windows_slanted-1.png" className="w-4 h-4" alt="start" />
                <span className="italic font-black text-sm">Start</span>
            </button>
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