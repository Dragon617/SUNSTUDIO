import React, { useState, useEffect } from 'react';
import { X, Save, Key, ExternalLink, Globe, ShieldCheck, AlertCircle } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [polloKey, setPolloKey] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [hasGoogleKey, setHasGoogleKey] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('pollo_api_key');
    if (stored) setPolloKey(stored);

    const checkGoogleKey = async () => {
        if (window.aistudio) {
            const hasKey = await window.aistudio.hasSelectedApiKey();
            setHasGoogleKey(hasKey);
        }
    };
    checkGoogleKey();
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('pollo_api_key', polloKey.trim());
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
    setTimeout(onClose, 500);
  };

  const handleOpenGoogleKey = async () => {
    if (window.aistudio) {
        await window.aistudio.openSelectKey();
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasGoogleKey(hasKey);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="w-[520px] bg-[#1c1c1e] border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/5 flex justify-between items-center bg-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-800 rounded-xl">
                <Globe size={20} className="text-cyan-400" />
            </div>
            <div>
                <h2 className="text-base font-bold text-white leading-none">系统设置</h2>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1 inline-block">System Configuration</span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-slate-500 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
          
          {/* Google AI Studio Key Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Key size={14} className="text-cyan-400" />
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Google AI Studio API Key</label>
                </div>
                {hasGoogleKey ? (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30">
                        <ShieldCheck size={10} className="text-emerald-400" />
                        <span className="text-[9px] font-bold text-emerald-400 uppercase">已连接</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30">
                        <AlertCircle size={10} className="text-amber-400" />
                        <span className="text-[9px] font-bold text-amber-400 uppercase">未配置</span>
                    </div>
                )}
            </div>

            <div className="p-4 bg-black/30 border border-white/5 rounded-2xl space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                    使用 <strong>Veo (Google 视频生成)</strong> 模型需要您选择一个已开启结算的付费 GCP 项目。生成高质量视频会消耗您的 API 配额。
                </p>
                <div className="flex gap-3">
                    <button 
                        onClick={handleOpenGoogleKey}
                        className="flex-1 bg-white text-black hover:bg-cyan-400 py-3 rounded-xl text-xs font-bold transition-all shadow-lg flex items-center justify-center gap-2"
                    >
                        {hasGoogleKey ? '更换 API Key' : '选择 API Key'}
                    </button>
                    <a 
                        href="https://ai.google.dev/gemini-api/docs/billing" 
                        target="_blank" 
                        rel="noreferrer"
                        className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-400 hover:text-white transition-colors"
                        title="查看计费文档"
                    >
                        <ExternalLink size={18} />
                    </a>
                </div>
            </div>
          </div>

          <div className="h-px bg-white/5" />

          {/* Pollo Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Key size={14} className="text-purple-400" />
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">Pollo.ai API Key (Wan 2.5)</label>
                </div>
                <a href="https://pollo.ai/dashboard/api-keys" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors">
                    <span>获取密钥</span>
                    <ExternalLink size={10} />
                </a>
            </div>
            
            <div className="relative group">
                <input 
                    type="password" 
                    autoComplete="off"
                    className="w-full bg-black/30 border border-white/10 rounded-2xl py-3.5 px-5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50 transition-colors font-mono"
                    placeholder="粘贴您的 Pollo API Key..."
                    value={polloKey}
                    onChange={(e) => setPolloKey(e.target.value)}
                />
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed px-1">
                用于激活第三方模型 <strong>Wan 2.1 / 2.5</strong>。密钥仅保存在本地存储，不会共享。
            </p>
          </div>
        </div>

        <div className="p-5 border-t border-white/5 bg-[#121214] flex justify-end gap-3">
            <button 
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-white transition-colors"
            >
                取消
            </button>
            <button 
                onClick={handleSave}
                className={`px-8 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xl ${isSaved ? 'bg-emerald-500 text-white' : 'bg-cyan-500 text-black hover:bg-cyan-400'}`}
            >
                {isSaved ? '已保存' : '确认并保存'}
            </button>
        </div>
      </div>
    </div>
  );
};