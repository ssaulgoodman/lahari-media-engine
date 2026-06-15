
import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ApiProject, ConceptOption, CastMember, Environment } from '../types';
import { ImageModal } from './ImageModal';
import { BlueprintContextBar, Phase, getActivePhase, phaseIndex } from './BlueprintContextBar';
import { ConceptPhase } from './ConceptPhase';
import { ScriptPhase } from './ScriptPhase';
import { StylePhase } from './StylePhase';
import { CharactersPhase } from './CharactersPhase';
import { EnvironmentsPhase } from './EnvironmentsPhase';
import { AudioPhase } from './AudioPhase';
import * as api from '../services/api';
import { isMissingKeyError } from '../services/api';

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
  // One-shot hint from elsewhere in the app (e.g. T6.8 Studio
  // lipsync-blocked chip → "go to Audio phase"). Read + clear on mount
  // so subsequent mounts revert to default activePhase logic.
  const initialPhase: Phase = (() => {
    try {
      const hint = sessionStorage.getItem('mirage:initialBlueprintPhase');
      if (hint) {
        sessionStorage.removeItem('mirage:initialBlueprintPhase');
        if (['concept','script','style','characters','environments','audio'].includes(hint)) {
          return hint as Phase;
        }
      }
    } catch {}
    return activePhase;
  })();
  const [viewPhase, setViewPhase] = useState<Phase>(initialPhase);
  const [modalImage, setModalImage] = useState<string | null>(null);

  // Environment look candidates — lifted to orchestrator so they survive tab switches
  const [envLooks, setEnvLooks] = useState<Record<string, { id: string; url: string }[]>>({});
  const [envGenerating, setEnvGenerating] = useState<Set<string>>(new Set());
  const hydratedCandidateProject = useRef<string | null>(null);
  const hydratedCharacterCandidates = useRef<Set<string>>(new Set());
  const hydratedEnvironmentCandidates = useRef<Set<string>>(new Set());

  // Shared inline error feedback. Banner accepts either a pre-formatted string
  // (most call sites) or a raw error/unknown — the latter lets BYOK-aware
  // paths surface a structured `missing_key` action link to /account/keys
  // without each call site re-implementing the detection.
  type ActionErrorState = {
    message: string;
    action?: { label: string; href: string };
  };
  const [actionError, setActionError] = useState<ActionErrorState | null>(null);
  const actionErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showActionError = (input: string | unknown) => {
    let state: ActionErrorState;
    if (typeof input === 'string') {
      state = { message: input };
    } else if (isMissingKeyError(input)) {
      const provider = input.provider ? input.provider.charAt(0).toUpperCase() + input.provider.slice(1) : '';
      state = {
        message: input.message,
        action: {
          label: provider ? `Set up ${provider} key` : 'Set up keys',
          href: input.setupUrl || '/account/keys',
        },
      };
    } else if (input instanceof Error) {
      state = { message: input.message };
    } else {
      state = { message: String(input || 'Unknown error') };
    }
    setActionError(state);
    if (actionErrorTimer.current) clearTimeout(actionErrorTimer.current);
    actionErrorTimer.current = setTimeout(() => setActionError(null), 8000);
  };

  // Snap viewPhase on backward transitions (unlocks) only
  const prevActivePhase = useRef(activePhase);
  useEffect(() => {
    const prev = prevActivePhase.current;
    prevActivePhase.current = activePhase;
    if (phaseIndex(project, activePhase) < phaseIndex(project, prev)) {
      setViewPhase(activePhase);
    }
  }, [activePhase]);

  useEffect(() => {
    if (hydratedCandidateProject.current !== project.id) {
      hydratedCandidateProject.current = project.id;
      hydratedCharacterCandidates.current = new Set();
      hydratedEnvironmentCandidates.current = new Set();
    }
  }, [project.id]);

  useEffect(() => {
    if (!onSetLookCandidates) return;
    let cancelled = false;
    const missingWithNoLoadedCandidates = project.cast.filter(member =>
      !member.referenceImageUrl &&
      !(lookCandidates[member.id]?.length) &&
      !hydratedCharacterCandidates.current.has(member.id)
    );
    if (missingWithNoLoadedCandidates.length === 0) return;

    void Promise.all(missingWithNoLoadedCandidates.map(async member => {
      try {
        const candidates = await api.getCandidates(project.id, 'character', member.id);
        if (!cancelled && candidates.length > 0) {
          hydratedCharacterCandidates.current.add(member.id);
          onSetLookCandidates(member.id, candidates);
        }
      } catch (err) {
        console.warn('Failed to hydrate character look candidates', { projectId: project.id, castMemberId: member.id, err });
      }
    }));

    return () => { cancelled = true; };
  }, [project.id, project.cast, lookCandidates, onSetLookCandidates]);

  useEffect(() => {
    let cancelled = false;
    const missingWithNoLoadedCandidates = project.environments.filter(environment =>
      !environment.referenceImageUrl &&
      !(envLooks[environment.id]?.length) &&
      !hydratedEnvironmentCandidates.current.has(environment.id)
    );
    if (missingWithNoLoadedCandidates.length === 0) return;

    void Promise.all(missingWithNoLoadedCandidates.map(async environment => {
      try {
        const candidates = await api.getCandidates(project.id, 'environment', environment.id);
        if (!cancelled && candidates.length > 0) {
          hydratedEnvironmentCandidates.current.add(environment.id);
          setEnvLooks(prev => ({ ...prev, [environment.id]: candidates }));
        }
      } catch (err) {
        console.warn('Failed to hydrate environment look candidates', { projectId: project.id, environmentId: environment.id, err });
      }
    }));

    return () => { cancelled = true; };
  }, [project.id, project.environments, envLooks]);

  // Phase content animation wrapper
  const phaseTransition = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.2 },
  };

  // Ready to launch?
  // Gate on the locked style IMAGE, not the description text. Curated preset
  // locks intentionally store an empty style_description (the image is the
  // ground truth; storing prose would leak pollution into concept-regen
  // hints — see commit c8385a0 / 103cbd7). Using styleDescription here
  // silently broke the Launch button for any project that locked a preset.
  const everyoneHasLook = project.cast.length > 0 && project.cast.every(c => !!c.referenceImageUrl);
  const everyEnvHasLook = project.environments.length === 0 || project.environments.every(e => !!e.referenceImageUrl);
  const showLaunch = !!project.styleAssetUrl && everyoneHasLook && everyEnvHasLook && project.scenes.length > 0;

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

        {viewPhase === 'audio' && (
          <AudioPhase
            project={project}
            isLoading={isLoading}
            phaseTransition={phaseTransition}
            onSetProject={onSetProject}
            onSetViewPhase={setViewPhase}
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
