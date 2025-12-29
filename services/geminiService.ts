import { GoogleGenAI, GenerateContentResponse, Type, Modality, Part, FunctionDeclaration } from "@google/genai";
import { SmartSequenceItem, VideoGenerationMode } from "../types";

// --- Initialization ---

const getClient = () => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing. Please select a paid API key via the Google AI Studio button.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

const getPolloKey = () => {
    return localStorage.getItem('pollo_api_key');
};

const getErrorMessage = (error: any): string => {
    if (!error) return "Unknown error";
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    if (error.error && error.error.message) return error.error.message;
    return JSON.stringify(error);
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function retryWithBackoff<T>(
  operation: () => Promise<T>, 
  maxRetries: number = 3, 
  baseDelay: number = 2000
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const msg = getErrorMessage(error).toLowerCase();
      const isOverloaded = error.status === 503 || error.code === 503 || msg.includes("overloaded") || msg.includes("503") || error.status === 429 || error.code === 429;

      if (isOverloaded && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(`API Overloaded (503/429). Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await wait(delay);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// --- Audio Helpers ---

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

const base64ToUint8Array = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

const combineBase64Chunks = (chunks: string[], sampleRate: number = 24000): string => {
    let totalLength = 0;
    const arrays: Uint8Array[] = [];
    
    for (const chunk of chunks) {
        const arr = base64ToUint8Array(chunk);
        arrays.push(arr);
        totalLength += arr.length;
    }

    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        merged.set(arr, offset);
        offset += arr.length;
    }

    const channels = 1;
    const bitDepth = 16;
    const header = new ArrayBuffer(44);
    const headerView = new DataView(header);
    
    writeString(headerView, 0, 'RIFF');
    headerView.setUint32(4, 36 + totalLength, true);
    writeString(headerView, 8, 'WAVE');
    writeString(headerView, 12, 'fmt ');
    headerView.setUint32(16, 16, true); 
    headerView.setUint16(20, 1, true); 
    headerView.setUint16(22, channels, true); 
    headerView.setUint32(24, sampleRate, true);
    headerView.setUint32(28, sampleRate * channels * (bitDepth / 8), true); 
    headerView.setUint16(32, channels * (bitDepth / 8), true); 
    headerView.setUint16(34, bitDepth, true);
    writeString(headerView, 36, 'data');
    headerView.setUint32(40, totalLength, true);
    
    const wavFile = new Uint8Array(header.byteLength + totalLength);
    wavFile.set(new Uint8Array(header), 0);
    wavFile.set(merged, header.byteLength);

    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < wavFile.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(wavFile.subarray(i, i + chunk)));
    }
    
    return 'data:audio/wav;base64,' + btoa(binary);
};

const pcmToWav = (base64PCM: string, sampleRate: number = 24000): string => {
    return combineBase64Chunks([base64PCM], sampleRate);
};

// --- Image/Video Utilities ---

export const urlToBase64 = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("Failed to convert URL to Base64", e);
        return "";
    }
};

const convertImageToCompatibleFormat = async (base64Str: string): Promise<{ data: string, mimeType: string, fullDataUri: string }> => {
    if (base64Str.match(/^data:image\/(png|jpeg|jpg);base64,/)) {
        const match = base64Str.match(/^data:(image\/[a-zA-Z+]+);base64,/);
        const mimeType = match ? match[1] : 'image/png';
        const data = base64Str.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
        return { data, mimeType, fullDataUri: base64Str };
    }
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error("Canvas context failed")); return; }
            ctx.drawImage(img, 0, 0);
            const pngDataUrl = canvas.toDataURL('image/png');
            const data = pngDataUrl.replace(/^data:image\/png;base64,/, "");
            resolve({ data, mimeType: 'image/png', fullDataUri: pngDataUrl });
        };
        img.onerror = (e) => reject(new Error("Image conversion failed for Veo compatibility"));
        img.src = base64Str;
    });
};

export const extractLastFrame = (videoSrc: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = "anonymous"; 
        video.src = videoSrc;
        video.muted = true;
        video.onloadedmetadata = () => { video.currentTime = Math.max(0, video.duration - 0.1); };
        video.onseeked = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/png'));
                } else {
                    reject(new Error("Canvas context failed"));
                }
            } catch (e) { reject(e); } finally { video.remove(); }
        };
        video.onerror = () => { reject(new Error("Video load failed for frame extraction")); video.remove(); };
    });
};

// --- System Prompts ---

const SYSTEM_INSTRUCTION = `
You are SunStudio AI, an expert multimedia creative assistant.
Your goal is to assist users in generating images, videos, audio, and scripts.
Always be concise, professional, and helpful.
When the user asks for creative ideas, provide vivid, detailed descriptions suitable for generative AI prompts.
`;

const STORYBOARD_INSTRUCTION = `
You are a professional film director and cinematographer.
Your task is to break down a user's prompt into a sequence of detailed shots (storyboard).
Output strictly valid JSON array of strings. No markdown.
Each string should be a highly detailed image generation prompt for one shot.
Example: ["Wide shot of a cyberpunk city...", "Close up of a neon sign..."]
`;

const VIDEO_ORCHESTRATOR_INSTRUCTION = `
You are a video prompt engineering expert.
Your task is to create a seamless video generation prompt that bridges a sequence of images.
Analyze the provided images and the user's intent to create a prompt that describes the motion and transition.
`;

const HELP_ME_WRITE_INSTRUCTION = `
# 🌟 提示词优化智能体 (Prompt Enhancer Agent) V2.1
优化用户输入的短文本为高质量 AI 提示词。
`;

// --- API Functions ---

export const sendChatMessage = async (
    history: { role: 'user' | 'model', parts: { text: string }[] }[], 
    newMessage: string,
    options?: { isThinkingMode?: boolean, isStoryboard?: boolean, isHelpMeWrite?: boolean }
): Promise<string> => {
    const ai = getClient();
    
    // Model Selection
    let modelName = 'gemini-3-flash-preview';
    let systemInstruction = SYSTEM_INSTRUCTION;

    if (options?.isThinkingMode) {
        modelName = 'gemini-3-pro-preview';
    }

    if (options?.isStoryboard) {
        systemInstruction = STORYBOARD_INSTRUCTION;
    } else if (options?.isHelpMeWrite) {
        systemInstruction = HELP_ME_WRITE_INSTRUCTION;
    }

    const chat = ai.chats.create({
        model: modelName,
        config: { systemInstruction },
        history: history
    });

    const result = await chat.sendMessage({ message: newMessage });
    return result.text || "No response";
};

export const generateImageFromText = async (
    prompt: string, 
    model: string, 
    inputImages: string[] = [], 
    options: { aspectRatio?: string, resolution?: string, count?: number } = {}
): Promise<string[]> => {
    const ai = getClient();
    const count = options.count || 1;
    
    const effectiveModel = model.includes('imagen') ? 'imagen-4.0-generate-001' : 'gemini-2.5-flash-image';
    
    // Prepare Contents
    const parts: Part[] = [];
    
    for (const base64 of inputImages) {
        const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, "");
        const mimeType = base64.match(/^data:(image\/\w+);base64,/)?.[1] || "image/png";
        parts.push({ inlineData: { data: cleanBase64, mimeType } });
    }
    
    parts.push({ text: prompt });

    try {
        const response = await ai.models.generateContent({
            model: effectiveModel,
            contents: { parts },
            config: {
                imageConfig: {
                    aspectRatio: options.aspectRatio as any || "1:1",
                    imageSize: options.resolution?.toUpperCase() === '1K' ? '1K' : options.resolution?.toUpperCase() === '2K' ? '2K' : options.resolution?.toUpperCase() === '4K' ? '4K' : '1K'
                }
            }
        });

        const images: string[] = [];
        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.data) {
                    const mime = part.inlineData.mimeType || 'image/png';
                    images.push(`data:${mime};base64,${part.inlineData.data}`);
                }
            }
        }

        if (images.length === 0) {
            throw new Error("No images generated. Safety filter might have been triggered.");
        }

        return images;
    } catch (e: any) {
        console.error("Image Gen Error:", e);
        throw new Error(getErrorMessage(e));
    }
};

export const generateVideo = async (
    prompt: string, 
    model: string, 
    options: { aspectRatio?: string, count?: number, generationMode?: VideoGenerationMode, resolution?: string } = {}, 
    inputImageBase64?: string | null,
    videoInput?: any,
    referenceImages?: string[]
): Promise<{ uri: string, isFallbackImage?: boolean, videoMetadata?: any, uris?: string[] }> => {
    // FRESH CLIENT FOR VEO KEY REQUIREMENTS
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const qualitySuffix = ", cinematic lighting, highly detailed, photorealistic, 4k, smooth motion, professional color grading";
    const enhancedPrompt = prompt + qualitySuffix;
    
    let resolution = options.resolution || '720p';

    // Prepare Inputs
    let inputs: any = { prompt: enhancedPrompt };
    
    // Config
    const config: any = {
        numberOfVideos: 1, 
        aspectRatio: options.aspectRatio || '16:9',
        resolution: resolution as any
    };

    // 1. Handle First and Last Frame Logic (FrameWeaver)
    if (options.generationMode === 'FIRST_LAST_FRAME' && referenceImages && referenceImages.length >= 2) {
        const startImg = await convertImageToCompatibleFormat(referenceImages[0]);
        const endImg = await convertImageToCompatibleFormat(referenceImages[referenceImages.length - 1]);
        inputs.image = { imageBytes: startImg.data, mimeType: startImg.mimeType };
        config.lastFrame = { imageBytes: endImg.data, mimeType: endImg.mimeType };
    } 
    // 2. Handle standard Image-to-Video
    else if (inputImageBase64) {
        try {
            const compat = await convertImageToCompatibleFormat(inputImageBase64);
            inputs.image = { imageBytes: compat.data, mimeType: compat.mimeType };
        } catch (e) {
            console.warn("Veo Input Image Conversion Failed:", e);
        }
    }

    if (videoInput) {
        inputs.video = videoInput;
    }

    const count = options.count || 1;
    
    try {
        const operations = [];
        for (let i = 0; i < count; i++) {
             operations.push(retryWithBackoff(async () => {
                 // Re-init AI within loop to ensure key freshness if needed
                 const innerAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
                 let op = await innerAi.models.generateVideos({
                     model: model,
                     ...inputs,
                     config: config
                 });
                 
                 while (!op.done) {
                     await wait(10000); 
                     op = await innerAi.operations.getVideosOperation({ operation: op });
                 }
                 return op;
             }));
        }

        const results = await Promise.allSettled(operations);
        const validUris: string[] = [];
        let primaryMetadata = null;

        for (const res of results) {
            if (res.status === 'fulfilled') {
                const vid = res.value.response?.generatedVideos?.[0]?.video;
                if (vid?.uri) {
                    const fullUri = `${vid.uri}&key=${process.env.API_KEY}`;
                    validUris.push(fullUri);
                    if (!primaryMetadata) primaryMetadata = vid;
                }
            }
        }

        if (validUris.length === 0) {
            const firstError = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
            throw firstError?.reason || new Error("Video generation failed.");
        }

        return { 
            uri: validUris[0], 
            uris: validUris, 
            videoMetadata: primaryMetadata,
            isFallbackImage: false 
        };

    } catch (e: any) {
        console.warn("Veo Generation Failed. Falling back to Image.", e);
        try {
            const fallbackPrompt = "Cinematic movie still, " + enhancedPrompt;
            const imgs = await generateImageFromText(fallbackPrompt, 'gemini-2.5-flash-image', [], { aspectRatio: options.aspectRatio });
            return { uri: imgs[0], isFallbackImage: true };
        } catch (imgErr) {
            throw new Error("Video generation failed: " + getErrorMessage(e));
        }
    }
};

export const analyzeVideo = async (videoBase64OrUrl: string, prompt: string, model: string): Promise<string> => {
    const ai = getClient();
    let inlineData: any = null;

    if (videoBase64OrUrl.startsWith('data:')) {
        const mime = videoBase64OrUrl.match(/^data:(video\/\w+);base64,/)?.[1] || 'video/mp4';
        const data = videoBase64OrUrl.replace(/^data:video\/\w+;base64,/, "");
        inlineData = { mimeType: mime, data };
    } else {
        throw new Error("Direct URL analysis not implemented.");
    }

    const response = await ai.models.generateContent({
        model: model,
        contents: {
            parts: [
                { inlineData },
                { text: prompt }
            ]
        }
    });

    return response.text || "Analysis failed";
};

export const editImageWithText = async (imageBase64: string, prompt: string, model: string): Promise<string> => {
     const imgs = await generateImageFromText(prompt, model, [imageBase64], { count: 1 });
     return imgs[0];
};

export const planStoryboard = async (prompt: string, context: string): Promise<string[]> => {
    const ai = getClient();
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        config: { 
            responseMimeType: 'application/json',
            systemInstruction: STORYBOARD_INSTRUCTION 
        },
        contents: { parts: [{ text: `Context: ${context}\n\nUser Idea: ${prompt}` }] }
    });
    
    try {
        return JSON.parse(response.text || "[]");
    } catch {
        return [];
    }
};

export const orchestrateVideoPrompt = async (images: string[], userPrompt: string): Promise<string> => {
     const ai = getClient();
     const parts: Part[] = images.map(img => ({ inlineData: { data: img.replace(/^data:.*;base64,/, ""), mimeType: "image/png" } }));
     parts.push({ text: `Create a single video prompt that transitions between these images. User Intent: ${userPrompt}` });
     
     const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        config: { systemInstruction: VIDEO_ORCHESTRATOR_INSTRUCTION },
        contents: { parts }
     });
     
     return response.text || userPrompt;
};

export const compileMultiFramePrompt = (frames: any[]) => {
    return "A sequence showing: " + frames.map(f => f.transition?.prompt || "scene").join(" transitioning to ");
};

export const generateAudio = async (
    prompt: string, 
    referenceAudio?: string, 
    options?: { persona?: any, emotion?: any }
): Promise<string> => {
    const ai = getClient();
    const parts: Part[] = [{ text: prompt }];
    const voiceName = options?.persona?.label === 'Deep Narrative' ? 'Kore' : 'Puck'; 
    
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: { parts },
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName }
                }
            }
        }
    });
    
    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) throw new Error("Audio generation failed");
    
    return pcmToWav(audioData);
};

export const transcribeAudio = async (audioBase64: string): Promise<string> => {
    const ai = getClient();
    const mime = audioBase64.match(/^data:(audio\/\w+);base64,/)?.[1] || 'audio/wav';
    const data = audioBase64.replace(/^data:audio\/\w+;base64,/, "");
    
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
            parts: [
                { inlineData: { mimeType: mime, data } },
                { text: "Transcribe this audio strictly verbatim." }
            ]
        }
    });
    
    return response.text || "";
};

export const connectLiveSession = async (
    onAudioData: (base64: string) => void,
    onClose: () => void
) => {
    const ai = getClient();
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';
    const sessionPromise = ai.live.connect({
        model,
        callbacks: {
            onopen: () => console.log("Live Session Connected"),
            onmessage: (msg) => {
                if (msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
                    onAudioData(msg.serverContent.modelTurn.parts[0].inlineData.data);
                }
            },
            onclose: onClose,
            onerror: (e) => { console.error(e); onClose(); }
        },
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
            }
        }
    });
    return sessionPromise;
};