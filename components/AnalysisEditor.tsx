
import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ApiProject, ConceptOption, CastMember, Environment, VideoMode } from '../types';
import { ImageModal } from './ImageModal';
import { BlueprintContextBar, Phase, getActivePhase, phaseIndex } from './BlueprintContextBar';
import { ConceptPhase } from './ConceptPhase';
import { ScriptPhase } from './ScriptPhase';
import { StylePhase } from './StylePhase';
import { CharactersPhase } from './CharactersPhase';
import { EnvironmentsPhase } from './EnvironmentsPhase';

interface Props {
  project: ApiProject;
  isLoading: boolean;
  looksLoading: Set<string>;
  lookCandidates: Record<string, { id: string; url: string }[]>;
  onSetLookCandidates?: (castMemberId: string, candidates: { id: string; url: string }[]) => void;
  onDiscardLookCandidates?: (castMemberId: string) => void;
  onLockConcept: (index: number) => void;
  onLockStyle: (assetId: string, styleDescription?: string) => void;
  onUnlockStyle: () => void;
  onGenerateLooks: (castMemberId: string, feedback?: string, refImage?: File) => void | Promise<void>;
  onLockCharacter: (castMemberId: string, assetId: string) => void;
  onAddCast: (name: string, description: string) => void;
  onUpdateCast: (memberId: string, updates: { name?: string; description?: string; generationPrompt?: string }) => void;
  onDeleteCast: (memberId: string) => void;
  onConfirmDestructive?: (opts: { title: string; description: string; confirmLabel?: string; run: () => any }) => void;
  onGenerateScript: (userNote?: string) => void;
  onRefineScript?: (feedback: string) => void;
  onUpdateScene?: (sceneId: string, updates: { narrativeDescription?: string }) => void;
  onUpdateShot?: (sceneId: string, shotId: string, updates: { direction?: string; visualPrompt?: string; castIds?: string[]; environmentId?: string | null; duration?: number }) => void;
  onGenerateConcepts?: (opts?: { userNote?: string; directorBrief?: string }) => void;
  onCancelConcepts?: () => void;
  onCancelScript?: () => void;
  onUnlockConcept?: () => void;
  onRefineConcept?: (feedback: string) => Promise<void> | void;
  onUpdateConcept?: (updates: Record<string, any>) => Promise<void> | void;
  onUnlockScript?: () => void;
  onUnlockCharacters?: () => void;
  onUnlockEnvironments?: () => void;
  onUpdateProject: (updates: Record<string, any>) => void;
  onLaunchStudio: () => void;
  onAdvanceCharacters: () => void;
  onAdvanceEnvironments: () => void;
  onSetProject?: (project: ApiProject) => void;
}

export const AnalysisEditor: React.FC<Props> = ({
  project, isLoading, looksLoading, lookCandidates, onSetLookCandidates, onDiscardLookCandidates,
  onLockConcept, onLockStyle, onUnlockStyle,
  onGenerateLooks, onLockCharacter, onAddCast, onUpdateCast, onDeleteCast,
  onGenerateScript, onRefineScript, onUpdateScene, onUpdateShot, onGenerateConcepts, onCancelConcepts, onCancelScript, onUnlockConcept, onRefineConcept, onUpdateConcept, onUnlockScript, onUnlockCharacters, onUnlockEnvironments, onUpdateProject, onLaunchStudio, onAdvanceCharacters, onAdvanceEnvironments, onSetProject, onConfirmDestructive,
}) => {
  const activePhase = getActivePhase(project);
  const [viewPhase, setViewPhase] = useState<Phase>(activePhase);
  const [modalImage, setModalImage] = useState<string | null>(null);

  // Environment look candidates — lifted to orchestrator so they survive tab switches
  const [envLooks, setEnvLooks] = useState<Record<string, { id: string; url: string }[]>>({});
  const [envGenerating, setEnvGenerating] = useState<Set<string>>(new Set());

  // Shared inline error feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const actionErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showActionError = (msg: string) => {
    setActionError(msg);
    if (actionErrorTimer.current) clearTimeout(actionErrorTimer.current);
    actionErrorTimer.current = setTimeout(() => setActionError(null), 8000);
  };

  // Snap viewPhase on backward transitions (unlocks) only
  const prevActivePhase = useRef(activePhase);
  useEffect(() => {
    const prev = prevActivePhase.current;
    prevActivePhase.current = activePhase;
    if (phaseIndex(activePhase) < phaseIndex(prev)) {
      setViewPhase(activePhase);
    }
  }, [activePhase]);

  // Phase content animation wrapper
  const phaseTransition = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.2 },
  };

  // Ready to launch?
  const everyoneHasLook = project.cast.length > 0 && project.cast.every(c => !!c.referenceImageUrl);
  const everyEnvHasLook = project.environments.length === 0 || project.environments.every(e => !!e.referenceImageUrl);
  const showLaunch = !!project.styleDescription && everyoneHasLook && everyEnvHasLook && project.scenes.length > 0;

  return (
    <div className="max-w-5xl mx-auto pb-32">
      <BlueprintContextBar
        project={project}
        isLoading={isLoading}
        viewPhase={viewPhase}
        activePhase={activePhase}
        showLaunch={showLaunch}
        actionError={actionError}
        onSetViewPhase={setViewPhase}
        onUpdateProject={onUpdateProject}
        onLaunchStudio={onLaunchStudio}
        onSetProject={onSetProject}
        onClearActionError={() => setActionError(null)}
        showActionError={showActionError}
      />

      {/* Phase Content */}
      <AnimatePresence mode="wait">
        {viewPhase === 'concept' && (
          <ConceptPhase
            project={project}
            isLoading={isLoading}
            phaseTransition={phaseTransition}
            onLockConcept={onLockConcept}
            onGenerateConcepts={onGenerateConcepts}
            onCancelConcepts={onCancelConcepts}
            onUnlockConcept={onUnlockConcept}
            onRefineConcept={onRefineConcept}
            onUpdateConcept={onUpdateConcept}
            onSetViewPhase={setViewPhase}
          />
        )}

        {viewPhase === 'script' && (
          <ScriptPhase
            project={project}
            isLoading={isLoading}
            phaseTransition={phaseTransition}
            onGenerateScript={onGenerateScript}
            onRefineScript={onRefineScript}
            onUpdateScene={onUpdateScene}
            onUpdateShot={onUpdateShot}
            onCancelScript={onCancelScript}
            onUnlockScript={onUnlockScript}
            onUpdateProject={onUpdateProject}
            onSetProject={onSetProject}
            onSetViewPhase={setViewPhase}
            showActionError={showActionError}
          />
        )}

        {viewPhase === 'style' && (
          <StylePhase
            project={project}
            isLoading={isLoading}
            phaseTransition={phaseTransition}
            onLockStyle={onLockStyle}
            onUnlockStyle={onUnlockStyle}
            onUpdateProject={onUpdateProject}
            onSetProject={onSetProject}
            onSetViewPhase={setViewPhase}
            onOpenModal={setModalImage}
            showActionError={showActionError}
          />
        )}

        {viewPhase === 'characters' && (
          <CharactersPhase
            project={project}
            isLoading={isLoading}
            looksLoading={looksLoading}
            lookCandidates={lookCandidates}
            phaseTransition={phaseTransition}
            onSetLookCandidates={onSetLookCandidates}
            onDiscardLookCandidates={onDiscardLookCandidates}
            onGenerateLooks={onGenerateLooks}
            onLockCharacter={onLockCharacter}
            onAddCast={onAddCast}
            onUpdateCast={onUpdateCast}
            onDeleteCast={onDeleteCast}
            onUnlockCharacters={onUnlockCharacters}
            onAdvanceCharacters={onAdvanceCharacters}
            onSetProject={onSetProject}
            onSetViewPhase={setViewPhase}
            onOpenModal={setModalImage}
            onConfirmDestructive={onConfirmDestructive}
            showActionError={showActionError}
          />
        )}

        {viewPhase === 'environments' && (
          <EnvironmentsPhase
            project={project}
            isLoading={isLoading}
            envLooks={envLooks}
            envGenerating={envGenerating}
            onSetEnvLooks={setEnvLooks}
            onSetEnvGenerating={setEnvGenerating}
            phaseTransition={phaseTransition}
            onUnlockEnvironments={onUnlockEnvironments}
            onAdvanceEnvironments={onAdvanceEnvironments}
            onSetProject={onSetProject}
            onOpenModal={setModalImage}
            onConfirmDestructive={onConfirmDestructive}
            showActionError={showActionError}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modalImage && <ImageModal src={modalImage} onClose={() => setModalImage(null)} />}
      </AnimatePresence>
    </div>
  );
};
