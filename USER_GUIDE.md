# Lahari Media Engine - User Guide

Welcome to **Lahari**, an AI-powered studio designed to create cinematic music videos for devotional and classical content. This tool acts as your **AI Co-Director**, handling everything from scriptwriting to video rendering.

---

## 🚀 Quick Start Workflow

### Phase 1: Import (The Setup)
1.  **Upload Audio**: Select your master audio track (`.mp3`, `.wav`).
2.  **Add Metadata**:
    *   **Title**: Give the AI a hint (e.g., "Pranathosmi").
    *   **Language**: Critical for accurate lyrics (e.g., "Sanskrit", "Kannada").
    *   **Context**: Mention the Deity or Theme (e.g., "Lord Murugan", "Temple Festival").
3.  **What happens?**
    *   Gemini 3 Pro listens to your audio.
    *   It uses **Google Search** to verify the song details (lyrics, history).
    *   It extracts the **Musical Structure** (Verse, Chorus) and generates an **SRT Subtitle file**.

### Phase 2: Blueprint (The Vision)
This is where you define the *soul* of your video.
1.  **Concept Tab**: Review the extracted themes. Download the `.SRT` file if you need subtitles later.
2.  **Visuals Tab (Important!)**:
    *   **Style**: Click "Generate Style Grid" to see 4 AI-generated art styles. Pick one to lock the "Look & Feel".
    *   **Cast**: Define your characters (e.g., "Lord Shiva", "The Devotee").
    *   **Look Dev**: Select a character and click "Generate Looks". Pick the best image. *This image becomes the "Anchor" to ensure the character looks the same in every shot.*
3.  **Script Tab**: Click "Generate Script". The AI listens to the music beats and writes a scene-by-scene screenplay.

### Phase 3: Studio (The Production)
This is your editing timeline.
1.  **Audio Sync**: Click the **Play (▶)** button on a scene header to hear just that specific segment of music. Feel the mood!
2.  **Generate Images**:
    *   Click "Generate Img" for a shot.
    *   **The AI Agent**: It doesn't just generate an image; it *critiques* itself. You'll see "Critiquing Scene...". If the lighting or character doesn't match your Anchor Reference, it auto-retries until it gets a high score (8/10+).
3.  **Generate Video**:
    *   Once you love the image, click "Generate Video".
    *   **Veo (Video Model)** animates the image into a 5-second clip.
    *   *Pro Tip*: Enable "Morph to Next Shot" to blend clips seamlessly.

### Phase 4: Render (The Assembly)
1.  Go to the **Render** tab.
2.  Click "Start Render".
3.  **Client-Side Magic**: The app downloads all your clips and stitches them together *inside your browser* using FFmpeg. No massive file uploads needed.
4.  Download your final `.mp4` Master.

---

## 🧠 Under the Hood

### The "Smart" Architecture
Unlike basic AI generators, Lahari uses an **Agentic Loop**:
1.  **Context Injection**: When you generate a shot of "Lord Shiva", the system injects the specific "Anchor Image" you chose in Phase 2. This prevents the "shapeshifting" problem common in AI video.
2.  **The Critique Loop**: After generating an image, a second AI (The Critic) looks at it and asks: *"Does this look like the reference? Is the lighting cinematic?"* If not, it forces a redraw with corrections.
3.  **Rolling Context**: Each shot knows about the *previous* shot, ensuring lighting and weather continuity.

### Models Used
*   **Gemini 3 Pro (Preview)**: The "Brain" (Scripting, Audio Analysis, Vision Critique). It listens to the music and checks the images.
*   **Gemini 3 Pro Image**: The "Painter" (State-of-the-art Image Generation).
*   **Veo**: The "Camera" (High-quality video generation from images).
*   **FFmpeg WASM**: The "Editor" (Stitches video/audio in the browser).

### Data Privacy
*   **Local First**: Your project state is saved to your browser's `localStorage`. If you refresh, your work comes back.
*   **Keys**: Your API key stays local (in `.env`).

---

## 💡 Pro Tips
*   **Save Often**: Use the "Save" button in the top right to download a `.json` backup of your project.
*   **Be Specific**: In Phase 1, "Sanskrit" is better than "Indian Language".
*   **Budget**: Watch the "Est. Cost" in the top right to keep track of your API usage.

