import React, { useState, useEffect, useRef } from 'react';
import mqtt from 'mqtt';
import { Send, Copy, LogOut, Terminal, ShieldCheck, User, ArrowLeft, Wifi, WifiOff, AlertTriangle, Link as LinkIcon, Share2, Maximize2, Activity, Lock, Globe } from 'lucide-react';
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
  const [isRemoteTyping, setIsRemoteTyping] = useState<boolean>(false);

  // --- Refs ---
  const clientRef = useRef<mqtt.MqttClient | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const topicRef = useRef<string>('');
  
  // Typing Refs
  const typingSendTimeoutRef = useRef<any>(null);
  const typingReceiveTimeoutRef = useRef<any>(null);

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

  // Cleanup on unmount or screen change
  useEffect(() => {
      return () => {
          if (clientRef.current) {
              try {
                clientRef.current.end();
              } catch(e) {}
          }
      };
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    if (screen === AppScreen.CHAT) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, screen, isRemoteTyping]);

  // Request Notification Permission when entering chat
  useEffect(() => {
    if (screen === AppScreen.CHAT && 'Notification' in window) {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
  }, [screen]);

  // --- Handlers ---

  const initHostSession = async () => {
      const newCode = generateSessionCode();
      const parsed = parseSessionCode(newCode);
      
      if (!parsed) {
          setErrorMsg("Error generating secure code.");
          return;
      }

      setSessionCode(parsed.rawCode);
      setRoomKey(parsed.key);
      setStatus('Connecting to Relay...');
      setErrorMsg(null);

      connectToMqtt(parsed.rawCode, parsed.key);
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
      setStatus('Connecting to Relay...');
      
      connectToMqtt(parsed.rawCode, parsed.key);
  };

  const connectToMqtt = (code: string, key: string) => {
      // Disconnect if exists
      if (clientRef.current) {
          clientRef.current.end();
      }

      // Architecture: MQTT over WebSockets.
      // This uses a public broker but keeps messages E2EE encrypted.
      // This works on 4G, Different Wifi, Different Countries because it uses standard HTTP ports.
      const brokerUrl = 'wss://broker.hivemq.com:8000/mqtt';
      const topic = `retrochat95/v1/channel/${code}`;
      topicRef.current = topic;

      console.log(`Connecting to ${brokerUrl} on topic ${topic}`);

      try {
          const client = mqtt.connect(brokerUrl, {
              clientId: 'rc95_' + Math.random().toString(16).substr(2, 8),
              keepalive: 60,
              clean: true,
              reconnectPeriod: 1000,
          });

          clientRef.current = client;

          client.on('connect', () => {
              console.log('MQTT Connected');
              setStatus('Connected');
              
              // Subscribe to the specific room topic
              client.subscribe(topic, (err) => {
                  if (!err) {
                      setScreen(AppScreen.CHAT);
                      setErrorMsg(null);
                      // Announce presence (encrypted)
                      sendSystemAnnouncement(client, topic, key, "USER_JOINED");
                  } else {
                      setErrorMsg("Subscription Failed");
                  }
              });
          });

          client.on('message', async (topic, message) => {
               try {
                   // Message is Buffer, convert to string -> JSON
                   const payloadStr = message.toString();
                   const msg = JSON.parse(payloadStr) as NetworkMessage;

                   // Ignore messages from myself
                   if (msg.sender === username && msg.type !== 'SYSTEM') return;

                   if (msg.type === 'TYPING') {
                       handleRemoteTyping();
                       return;
                   }

                   if (msg.type === 'CHAT' && msg.payload) {
                       const decryptedText = await decryptMessage(msg.payload, key);
                       addMessage(msg.sender || 'Unknown', decryptedText);
                       sendNotification(msg.sender || 'User', decryptedText);
                   }
                   
                   if (msg.type === 'SYSTEM' && msg.payload) {
                       // Optional: Decrypt system messages if you want them secure too
                       // For now assuming system messages might be plaintext status codes or encrypted
                       // Let's assume encrypted for consistency
                       try {
                           const status = await decryptMessage(msg.payload, key);
                           if (status === "USER_JOINED" && msg.sender !== username) {
                               addSystemMessage(`${msg.sender} connected via Relay.`);
                           }
                       } catch(e) {}
                   }

               } catch (e) {
                   console.error("Message processing error", e);
               }
          });

          client.on('error', (err) => {
              console.error('Connection error: ', err);
              setStatus('Net Error');
              setErrorMsg('Connection unstable. Retrying...');
          });

          client.on('offline', () => {
              setStatus('Reconnecting...');
          });

      } catch (e: any) {
          console.error("MQTT Error:", e);
          setErrorMsg("Init Failed.");
      }
  };

  const handleRemoteTyping = () => {
      setIsRemoteTyping(true);
      if (typingReceiveTimeoutRef.current) clearTimeout(typingReceiveTimeoutRef.current);
      typingReceiveTimeoutRef.current = setTimeout(() => {
          setIsRemoteTyping(false);
      }, 3000);
  };

  // Keep ref updated for callbacks
  const roomKeyRef = useRef(roomKey);
  useEffect(() => { roomKeyRef.current = roomKey; }, [roomKey]);
  
  // Use a ref for username to access in closures
  const usernameRef = useRef(username);
  useEffect(() => { usernameRef.current = username; }, [username]);

  // Handle typing indicator transmission
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputText(val);

      if (val.length > 0 && clientRef.current?.connected) {
          if (!typingSendTimeoutRef.current) {
              const msg: NetworkMessage = { type: 'TYPING', sender: usernameRef.current };
              clientRef.current.publish(topicRef.current, JSON.stringify(msg));
              
              typingSendTimeoutRef.current = setTimeout(() => {
                  typingSendTimeoutRef.current = null;
              }, 1000);
          }
      }
  };

  const sendSystemAnnouncement = async (client: mqtt.MqttClient, topic: string, key: string, statusMsg: string) => {
      try {
          const encrypted = await encryptMessage(statusMsg, key);
          const netMsg: NetworkMessage = {
              type: 'SYSTEM',
              sender: usernameRef.current,
              payload: encrypted
          };
          client.publish(topic, JSON.stringify(netMsg));
      } catch (e) {}
  };

  const sendMessage = async () => {
      if (!inputText.trim()) return;
      
      const textToSend = inputText;
      setInputText('');
      // Optimistically add to UI
      addMessage(username, textToSend);

      if (clientRef.current && clientRef.current.connected) {
          try {
              const encrypted = await encryptMessage(textToSend, roomKey);
              const netMsg: NetworkMessage = {
                  type: 'CHAT',
                  sender: username,
                  payload: encrypted
              };
              clientRef.current.publish(topicRef.current, JSON.stringify(netMsg));
          } catch (e) {
              addSystemMessage("Encryption failed.");
          }
      } else {
          addSystemMessage("Not connected to Relay.");
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
      if (clientRef.current) {
          clientRef.current.end();
          clientRef.current = null;
      }
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
                                <Globe size={32} className={status.includes('Reconnecting') || status.includes('Connecting') ? "animate-spin" : ""}/>
                                <span className="font-bold">{status}</span>
                                {status.includes('Connecting') && <span className="text-xs max-w-[200px] text-center">Contacting secure relay server...</span>}
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
                                {status.includes('Connecting') ? 'SEARCHING...' : 'ESTABLISH LINK'}
                            </Win95Button>
                            
                            {status.includes('Connecting') && (
                                <div className="mt-4 flex flex-col items-center justify-center text-xs text-gray-500 animate-pulse">
                                    <Globe size={24} className="mb-1 animate-spin"/>
                                    Connecting to relay...
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
        <div className="h-12 bg-[#000080] flex items-center justify-between px-3 shadow-md shrink-0 z-10">
            <div className="flex items-center gap-2 text-white font-bold text-lg truncate">
                <Terminal size={18} />
                <span>CHAT_{sessionCode.substring(0,6)}</span>
            </div>
            <div className="flex items-center gap-3">
                {status === 'Connected' ? <Wifi size={18} className="text-green-400"/> : <WifiOff size={18} className="text-red-400"/>}
                
                <button 
                    onClick={() => {
                        if (!document.fullscreenElement) {
                             document.documentElement.requestFullscreen().catch(() => {});
                        } else {
                             document.exitFullscreen().catch(() => {});
                        }
                    }}
                    className="w-8 h-8 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-black border-r-black flex items-center justify-center active:border-t-black active:border-l-black active:border-b-white active:border-r-white"
                >
                    <Maximize2 size={16} className="text-black" />
                </button>

                <button 
                    onClick={() => {
                       window.location.reload();
                    }}
                    className="w-8 h-8 bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-black border-r-black flex items-center justify-center active:border-t-black active:border-l-black active:border-b-white active:border-r-white"
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
                    <p className="text-xs mt-2">CONNECTED VIA RELAY</p>
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
                            <div className="flex items-center gap-1 mt-1 px-1 opacity-60 select-none">
                                <span className="text-[10px] text-gray-400">
                                    {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </span>
                                <Lock size={10} className="text-gray-400" />
                            </div>
                        </div>
                    )}
                </div>
            ))}
            {/* Visual spacer for typing indicator so it doesn't overlap last message when scrolled */}
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