
import React, { ReactNode } from 'react';
import { Minimize2, X, Maximize2 } from 'lucide-react';

interface WindowProps {
    title: string;
    children: ReactNode;
    className?: string;
    icon?: ReactNode;
    onClose?: () => void;
}

export const Win95Window: React.FC<WindowProps> = ({ title, children, className = '', icon, onClose }) => {
    
    const handleMinimize = () => {
         if (document.fullscreenElement) {
             document.exitFullscreen().catch(err => console.log(err));
         }
    };

    const handleMaximize = () => {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(err => console.log(err));
        }
    };

    return (
        <div className={`bg-[#c0c0c0] border-2 border-t-white border-l-white border-b-black border-r-black flex flex-col text-black ${className}`}>
            {/* Title Bar */}
            <div className="bg-[#000080] px-1 py-1 flex items-center justify-between select-none shrink-0">
                <div className="flex items-center gap-2 text-white font-bold text-lg truncate px-1">
                    {icon}
                    <span>{title}</span>
                </div>
                <div className="flex gap-1">
                    <button onClick={handleMinimize} className="w-5 h-5 bg-[#c0c0c0] border border-t-white border-l-white border-b-black border-r-black flex items-center justify-center active:border-t-black active:border-l-black active:border-b-white active:border-r-white">
                        <Minimize2 size={10} className="text-black" />
                    </button>
                    <button onClick={handleMaximize} className="w-5 h-5 bg-[#c0c0c0] border border-t-white border-l-white border-b-black border-r-black flex items-center justify-center active:border-t-black active:border-l-black active:border-b-white active:border-r-white">
                        <Maximize2 size={10} className="text-black" />
                    </button>
                    {onClose && (
                        <button 
                            onClick={onClose}
                            className="w-5 h-5 bg-[#c0c0c0] border border-t-white border-l-white border-b-black border-r-black flex items-center justify-center active:border-t-black active:border-l-black active:border-b-white active:border-r-white ml-1"
                        >
                            <X size={12} className="text-black" />
                        </button>
                    )}
                </div>
            </div>
            
            {/* Content Area */}
            <div className="p-1 flex-1 flex flex-col overflow-hidden text-black min-h-0">
                {children}
            </div>
        </div>
    );
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    primary?: boolean;
}

export const Win95Button: React.FC<ButtonProps> = ({ children, className = '', primary, ...props }) => {
    return (
        <button 
            className={`
                px-4 py-2
                bg-[#c0c0c0] 
                text-black font-bold uppercase tracking-wide
                border-2 border-t-white border-l-white border-b-black border-r-black 
                active:border-t-black active:border-l-black active:border-b-white active:border-r-white
                active:translate-y-[1px]
                focus:outline-dotted focus:outline-1 focus:outline-black focus:outline-offset-[-4px]
                touch-manipulation
                select-none
                ${className}
            `} 
            {...props}
        >
            {children}
        </button>
    );
};

export const Win95Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => {
    return (
        <input 
            className={`
                w-full bg-white !text-black px-2 py-2
                border-2 border-t-black border-l-black border-b-white border-r-white
                focus:outline-none font-mono
                placeholder:text-gray-500
                read-only:!text-black read-only:!opacity-100 read-only:bg-gray-200
                disabled:!text-black disabled:!opacity-100
                ${props.className}
            `}
            style={{ fontSize: '16px' }} // Critical: Prevents iOS zoom on focus
            {...props} 
        />
    );
};

export const Win95Panel: React.FC<{ children: ReactNode; className?: string }> = ({ children, className = '' }) => {
    return (
        <div className={`
            bg-white border-2 border-t-black border-l-black border-b-white border-r-white text-black
            ${className}
        `}>
            {children}
        </div>
    );
};
