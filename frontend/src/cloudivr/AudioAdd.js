import React, { useState } from 'react';
import { Upload, Wand2, Music } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { UploadCard, TtsCard } from './pages/AudioLibrary';

// Add audio to the library without leaving the page; the new audio is handed back so the picker can select it.
export function AudioAddDialog({ open, mode, setMode, onClose, onAdded, testid }) {
  const done = (a) => { onClose(); if (a) onAdded(a); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="civr !min-h-0 content-start max-w-2xl max-h-[90dvh] overflow-y-auto" data-testid={`${testid}-dialog`}>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Add audio</DialogTitle>
          <DialogDescription>It is saved to your audio library and picked here straight away.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2" role="tablist" aria-label="How to add audio">
          {[['upload', 'Upload a recording', Upload], ['tts', 'Make one from text', Wand2]].map(([m, l, I]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`civr-pill cursor-pointer min-h-[44px] ${mode === m ? 'civr-pill-on' : ''}`} data-testid={`${testid}-tab-${m}`}><I className="w-4 h-4" />{l}</button>
          ))}
        </div>
        {mode === 'upload' ? <UploadCard onDone={done} /> : <TtsCard onDone={done} />}
      </DialogContent>
    </Dialog>
  );
}

export function useAudioAdd() {
  const [mode, setMode] = useState(null);
  return { open: !!mode, mode, setMode, start: setMode, close: () => setMode(null) };
}

export function EmptyAudio({ start, compact, testid }) {
  const btns = (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm min-h-[44px]" onClick={() => start('upload')} data-testid={`${testid}-empty-upload-button`}><Upload className="w-4 h-4" />Upload a recording</button>
      <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm min-h-[44px]" onClick={() => start('tts')} data-testid={`${testid}-empty-tts-button`}><Wand2 className="w-4 h-4" />Make one from text</button>
    </div>
  );
  if (compact) return <div data-testid={`${testid}-empty`}>{btns}</div>;
  return (
    <div className="rounded-xl border border-dashed border-[#3f3f46] p-4 space-y-3" data-testid={`${testid}-empty`}>
      <div className="flex items-start gap-3"><Music className="w-5 h-5 text-[#818cf8] shrink-0 mt-0.5" aria-hidden="true" />
        <div><div className="text-sm font-semibold">Your audio library is empty</div>
          <div className="text-xs text-[#a1a1aa] mt-0.5">Upload a recording or turn text into a voice. It is picked here automatically.</div></div>
      </div>
      {btns}
    </div>
  );
}
