import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export type DestructiveAction = {
  title: string;
  description: string;
  mode?: 'fork' | 'simple';
  confirmLabel?: string;
  overwriteLabel?: string;
  run: (opts: { fork: boolean }) => Promise<any> | any;
  onDone?: (result: any) => void;
};

type DestructiveActionDialogProps = {
  action: DestructiveAction | null;
  onCancel: () => void;
  onRun: (fork: boolean) => void;
};

export const DestructiveActionDialog: React.FC<DestructiveActionDialogProps> = ({ action, onCancel, onRun }) => (
  <AnimatePresence>
    {action && (
      <>
        <motion.div
          key="destructive-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 bg-black/70 z-[200] backdrop-blur-sm"
          onClick={onCancel}
        />
        <motion.div
          key="destructive-dialog"
          initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
          transition={{ duration: 0.15 }}
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,480px)] surface-raised rounded-xl z-[201] p-6 space-y-5"
        >
          <div className="space-y-2">
            <h3 className="text-lg font-medium text-white">{action.title}</h3>
            <p className="text-sm text-zinc-400 leading-relaxed">{action.description}</p>
          </div>
          {action.mode !== 'simple' && (
            <div className="surface-inset rounded-md p-3 text-xs text-zinc-400 leading-relaxed">
              <strong className="text-zinc-300">Fork</strong> creates a copy with a new name and performs the change on it. Original stays frozen as a snapshot you can open from the sidebar.
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onCancel}
              className="text-xs text-zinc-400 hover:text-zinc-300 px-3 py-2 rounded-md transition-colors"
            >Cancel</button>
            {action.mode === 'simple' ? (
              <button
                onClick={() => onRun(false)}
                className="text-xs font-semibold bg-red-500/90 text-white hover:bg-red-500 px-4 py-2 rounded-md transition-colors"
              >{action.confirmLabel || 'Confirm'}</button>
            ) : (
              <>
                <button
                  onClick={() => onRun(false)}
                  className="text-xs text-zinc-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] px-3 py-2 rounded-md transition-colors"
                >{action.overwriteLabel || 'Overwrite'}</button>
                <button
                  onClick={() => onRun(true)}
                  className="text-xs font-semibold bg-white text-black hover:bg-zinc-200 px-4 py-2 rounded-md transition-colors"
                >Fork & change</button>
              </>
            )}
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);
