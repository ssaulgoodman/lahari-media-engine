
import { GoogleGenAI, Type } from "@google/genai";
import { ProjectAnalysis, VideoScene, VideoShot, GenerationStatus, ChatMessage, VideoMode, ProjectConcept, VisualIdentity } from "../types";

// Helper to convert File to Base64
export const fileToGenerativePart = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data url part
      const base64 = base64String.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Extract style description from a reference image
 */
export const analyzeImageStyle = async (imageFile: File): Promise<string> => {
  const ai = getAI();
  const imageBase64 = await fileToGenerativePart(imageFile);

  const prompt = `
    Analyze this image and describe its "Art Style" in detail for a high-end image generator.
    Focus on:
    1. Lighting (e.g. volumetric, chiaroscuro, softbox)
    2. Camera/Lens (e.g. 35mm, wide angle, depth of field)
    3. Texture/Medium (e.g. film grain, oil paint, 3D render)
    4. Color Grading.
    
    Return a concise but descriptive prompt fragment.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: imageFile.type, data: imageBase64 } },
        { text: prompt }
      ]
    }
  });

  return response.text || "Cinematic, high contrast, warm lighting.";
};

/**
 * Stage 1: Analyze Audio Structure & Concept
 */
export const analyzeAudioConcepts = async (audioFile: File): Promise<ProjectConcept> => {
  const ai = getAI();
  const audioBase64 = await fileToGenerativePart(audioFile);

  const prompt = `
  You are a visionary film director and musicologist. Listen to the audio.
  
  1. Identify the Musical Structure (Intro, Verse, Chorus, etc.).
  2. Extract the Core Concepts: Title, Language, Deity/Subject, Mood.
  3. **Visual Engineering**:
     - Provide a detailed "Physical Description" of the Deity/Subject for an image generator (e.g. "Blue skin, matted hair, tiger skin vestments, ash markings").
     - Suggest a "Cinematic Art Style" (e.g. "Shot on Arri Alexa, low-key lighting, mythological grandeur").
     - Suggest a "Color Palette" (e.g. "Saffron, Deep Indigo, Gold").
  
  Return ONLY JSON.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: audioFile.type, data: audioBase64 } },
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          language: { type: Type.STRING },
          deity: { type: Type.STRING },
          mood: { type: Type.STRING },
          theme: { type: Type.STRING },
          visualSuggestions: {
            type: Type.OBJECT,
            properties: {
              physicalDescription: { type: Type.STRING },
              artStyle: { type: Type.STRING },
              colorPalette: { type: Type.STRING }
            }
          },
          musicalStructure: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                label: { type: Type.STRING },
                startTime: { type: Type.STRING },
                endTime: { type: Type.STRING },
                energyLevel: { type: Type.STRING, enum: ["Low", "Medium", "High"] },
                description: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  if (!response.text) throw new Error("No analysis generated");
  return JSON.parse(response.text);
};

/**
 * Stage 2: Generate Hero Look Concepts
 */
export const generateHeroPreviews = async (concept: ProjectConcept, visualIdentity: VisualIdentity): Promise<string[]> => {
    const ai = getAI();
    const images: string[] = [];
    
    // We generate 3 variations with distinct cinematic flavors
    const variations = [
        "Close-up Portrait, looking at camera",
        "Wide Establishment Shot, environmental grandeur",
        "Mid-Shot Action Pose, dynamic composition"
    ];

    for (const variant of variations) {
        // High-Fidelity Photorealism Prompt for Gemini 3 Pro Image (Nano Banana Pro)
        const prompt = `
            Generate a cinematic film still. Photorealistic.
            
            SUBJECT: ${visualIdentity.characterSheet} (${concept.deity}).
            The subject is depicted with reverence and authentic detail.
            
            ART DIRECTION: ${visualIdentity.styleDescription}.
            
            COMPOSITION: ${variant}.
            MOOD: ${concept.mood}.
            THEME: ${concept.theme}.
            
            TECHNICAL SPECS: Cinematic lighting, detailed texture, authentic film look, high resolution, correct anatomy.
            
            AVOID: Cartoonish, blurred, distorted faces, painting style (unless specified), extra fingers, watermark, text.
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3-pro-image-preview',
                contents: { parts: [{ text: prompt }] },
                config: {
                    imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
                }
            });

            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    images.push(`data:image/png;base64,${part.inlineData.data}`);
                }
            }
        } catch (e) {
            console.error("Failed to generate look variant", e);
        }
    }
    
    return images;
};

/**
 * Stage 3: Plan Scene List (Scripting) - SCENE -> SHOT Hierarchy
 */
export const planScenes = async (
  audioFile: File,
  analysis: ProjectAnalysis
): Promise<VideoScene[]> => {
  const ai = getAI();
  const audioBase64 = await fileToGenerativePart(audioFile);
  
  const { concept, visualIdentity } = analysis;

  const prompt = `
  You are an award-winning Director of Photography and Screenwriter. 
  Plan a high-end music video script based on the audio structure.
  
  CONTEXT:
  - Theme: ${concept.theme}
  - Mood: ${concept.mood}
  - Deity: ${concept.deity}
  - Style: ${visualIdentity.styleDescription}
  - Mode: ${visualIdentity.videoMode.toUpperCase()}
  
  INSTRUCTIONS:
  1. Break the song into NARRATIVE SCENES based on the musical structure.
  2. For EACH SCENE, break it down into CINEMATIC SHOTS.
  3. **Visual Prompts MUST be highly descriptive**: 
     - BAD: "Shiva dances."
     - GOOD: "Low angle wide shot of Lord Shiva performing the Tandava, cosmic energy swirling around him, dramatic silhouette against a burning galaxy, anamorphic lens."
  4. Ensure a variety of shots: Wide, Medium, Close-up, POV.
  
  OUTPUT STRUCTURE:
  - VideoScene
    - VideoShot
      - visualPrompt: Detailed cinematic image prompt.
      - motionPrompt: Specific camera movement for Veo (e.g. "Slow truck left", "Orbit around subject").
      - duration: Seconds.
  
  Return ONLY JSON.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        { inlineData: { mimeType: audioFile.type, data: audioBase64 } },
        { text: prompt }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                sectionLabel: { type: Type.STRING },
                startTime: { type: Type.STRING },
                endTime: { type: Type.STRING },
                lyrics: { type: Type.STRING },
                narrativeDescription: { type: Type.STRING },
                shots: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      duration: { type: Type.NUMBER },
                      visualPrompt: { type: Type.STRING },
                      motionPrompt: { type: Type.STRING }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!response.text) throw new Error("Failed to plan scenes");
  const data = JSON.parse(response.text);

  return data.scenes.map((s: any) => ({
    ...s,
    id: s.id || Math.random().toString(36).substr(2, 9),
    shots: (s.shots || []).map((shot: any) => ({
      ...shot,
      id: shot.id || Math.random().toString(36).substr(2, 9),
      imageStatus: GenerationStatus.IDLE,
      videoStatus: GenerationStatus.IDLE,
      useNextAsEndFrame: visualIdentity.videoMode === 'cinematic'
    }))
  }));
};

/**
 * Generate Shot Image with Deep Context
 */
export const generateShotImage = async (
    shot: VideoShot, 
    analysis: ProjectAnalysis, 
    sceneContext: { lyrics: string; narrative: string },
    previousShotImageUrl?: string
): Promise<string> => {
  const ai = getAI();
  const parts: any[] = [];
  const { visualIdentity, concept } = analysis;

  // 1. Add Hero Image (The Anchor)
  if (visualIdentity.heroImage) {
      parts.push({
          inlineData: {
              mimeType: 'image/png',
              data: visualIdentity.heroImage.split(',')[1]
          }
      });
  }

  // 2. Add Previous Shot (The Continuity)
  if (previousShotImageUrl) {
      parts.push({
          inlineData: {
              mimeType: 'image/png',
              data: previousShotImageUrl.split(',')[1]
          }
      });
  }

  // 3. Construct Deeply Contextual & Photorealistic Prompt for Gemini 3 Pro
  const textPrompt = `
    Create a cinematic film still.
    
    SCENE CONTEXT:
    - Subject: ${visualIdentity.characterSheet} (${concept.deity}).
    - Action/Moment: ${shot.visualPrompt}.
    - Narrative Meaning: ${sceneContext.narrative}.
    
    AESTHETICS:
    - Art Style: ${visualIdentity.styleDescription}.
    - Mood/Atmosphere: ${concept.mood}.
    
    TECHNICAL VISUALS:
    - Lighting: Cinematic, natural, source-motivated.
    - Camera: High resolution, film texture, professional color grading.
    
    INSTRUCTIONS:
    - Use the provided HERO IMAGE as the strict reference for the character's face, costume, and the overall color grading.
    ${previousShotImageUrl ? '- CONTINUITY: This is the NEXT FRAME after the "Previous Shot" image provided. Match the lighting and environment exactly.' : ''}
    
    Make it look like a high-budget movie production. No text, no watermark.
  `;

  parts.push({ text: textPrompt });

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: { parts: parts },
    config: {
      imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
    }
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  
  throw new Error("No image generated");
};

/**
 * Generate Shot Video (Keyframe Chaining)
 */
export const generateShotVideo = async (
  shot: VideoShot, 
  imageBase64: string, 
  nextShotImageBase64?: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const rawBase64 = imageBase64.split(',')[1];
  
  const config: any = {
    numberOfVideos: 1,
    resolution: '720p',
    aspectRatio: '16:9'
  };

  if (shot.useNextAsEndFrame && nextShotImageBase64) {
    const rawNextBase64 = nextShotImageBase64.split(',')[1];
    config.lastFrame = {
      imageBytes: rawNextBase64,
      mimeType: 'image/png'
    };
  }

  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: shot.motionPrompt || "Cinematic camera movement",
    image: {
      imageBytes: rawBase64,
      mimeType: 'image/png'
    },
    config: config
  });

  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) throw new Error("Video generation failed");

  const videoRes = await fetch(`${videoUri}&key=${process.env.API_KEY}`);
  const blob = await videoRes.blob();
  return URL.createObjectURL(blob);
};

export const chatWithDirector = async (
  currentAnalysis: ProjectAnalysis,
  currentScenes: VideoScene[],
  userMessage: string,
  history: ChatMessage[]
): Promise<{ text: string; updatedScenes?: VideoScene[]; updatedAnalysis?: Partial<ProjectAnalysis> }> => {
  const ai = getAI();
  
  const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [
          ...history.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
          { role: 'user', parts: [{ text: `User Message: ${userMessage}. (Provide advice on prompts)` }] }
      ]
  });
  
  return { text: response.text || "I can help guide you." };
};
