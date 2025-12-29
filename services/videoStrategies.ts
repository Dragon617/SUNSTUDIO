import { AppNode, VideoGenerationMode } from '../types';
import { extractLastFrame, urlToBase64, analyzeVideo, orchestrateVideoPrompt, generateImageFromText } from './geminiService';

export interface StrategyResult {
    finalPrompt: string;
    videoInput: any;
    inputImageForGeneration: string | null;
    referenceImages: string[] | undefined;
    generationMode: VideoGenerationMode;
}

// --- Module: Default (Basic Image-to-Video / Text-to-Video) ---
export const processDefaultVideoGen = async (
    node: AppNode, 
    inputs: AppNode[], 
    prompt: string
): Promise<StrategyResult> => {
    let inputImageForGeneration: string | null = null;
    const imageInput = inputs.find(n => n.data.image || n.data.croppedFrame);
    if (imageInput) {
        inputImageForGeneration = imageInput.data.croppedFrame || imageInput.data.image || null;
    }

    return {
        finalPrompt: prompt,
        videoInput: null,
        inputImageForGeneration,
        referenceImages: undefined,
        generationMode: 'DEFAULT'
    };
};

// --- Module: StoryContinuator (剧情延展) ---
export const processStoryContinuator = async (
    node: AppNode, 
    inputs: AppNode[], 
    prompt: string
): Promise<StrategyResult> => {
    let inputImages: string[] = [];
    const videoNode = inputs.find(n => n.data.videoUri || n.data.videoMetadata);
    
    if (videoNode && videoNode.data.videoUri) {
         try {
             let videoSrc = videoNode.data.videoUri;
             if (videoSrc.startsWith('http')) {
                 videoSrc = await urlToBase64(videoSrc); 
             }
             const lastFrame = await extractLastFrame(videoSrc);
             if (lastFrame) {
                 inputImages = [lastFrame];
             }
         } catch (e) {
             console.warn("StoryContinuator: Frame extraction failed", e);
         }
    }

    return {
        finalPrompt: prompt,
        videoInput: null,
        inputImageForGeneration: inputImages.length > 0 ? inputImages[0] : null,
        referenceImages: undefined,
        generationMode: 'CONTINUE'
    };
};

// --- Module: FrameWeaver (收尾插帧) ---
export const processFrameWeaver = async (
    node: AppNode, 
    inputs: AppNode[], 
    prompt: string
): Promise<StrategyResult> => {
    // Collect all unique images from input nodes
    const inputImages: string[] = [];
    inputs.forEach(n => {
        const src = n.data.croppedFrame || n.data.image;
        if (src) inputImages.push(src);
    });

    let finalPrompt = prompt;

    // Use AI to bridge the first and last images if prompt is minimal
    if (inputImages.length >= 2) {
        try { 
            finalPrompt = await orchestrateVideoPrompt([inputImages[0], inputImages[inputImages.length - 1]], prompt); 
        } catch (e) {
            console.warn("FrameWeaver: Orchestration failed", e);
        }
    }

    return {
        finalPrompt,
        videoInput: null,
        inputImageForGeneration: inputImages.length > 0 ? inputImages[0] : null, 
        referenceImages: inputImages, // Passed to geminiService to extract first/last
        generationMode: 'FIRST_LAST_FRAME'
    };
};

// --- Module: SceneDirector (局部分镜) ---
export const processSceneDirector = async (
    node: AppNode, 
    inputs: AppNode[], 
    prompt: string
): Promise<StrategyResult> => {
    let inputImageForGeneration: string | null = null;
    let upstreamContextStyle = "";

    const videoInputNode = inputs.find(n => n.data.videoUri);
    if (videoInputNode && videoInputNode.data.videoUri) {
        try {
            let vidData = videoInputNode.data.videoUri;
            if (vidData.startsWith('http')) vidData = await urlToBase64(vidData);
            upstreamContextStyle = await analyzeVideo(vidData, "Analyze the visual style briefly.", "gemini-3-flash-preview");
        } catch (e) { }
    }

    if (node.data.croppedFrame) {
        inputImageForGeneration = node.data.croppedFrame;
    } else {
        const cropSource = inputs.find(n => n.data.croppedFrame);
        if (cropSource) inputImageForGeneration = cropSource.data.croppedFrame!;
        else if (inputs.find(n => n.data.image)) inputImageForGeneration = inputs.find(n => n.data.image)!.data.image!;
    }

    let finalPrompt = `${prompt}. \n\nStyle: ${upstreamContextStyle}`;

    if (inputImageForGeneration) {
        try {
            const restorationPrompt = `Sharpen and upscale this crop to 4K cinematic quality. Preserve composition exactly. Description: ${prompt}.`;
            const restoredImages = await generateImageFromText(restorationPrompt, 'gemini-2.5-flash-image', [inputImageForGeneration], { aspectRatio: node.data.aspectRatio || '16:9', count: 1 });
            if (restoredImages && restoredImages.length > 0) inputImageForGeneration = restoredImages[0];
        } catch (e) { }
    }

    return {
        finalPrompt,
        videoInput: null,
        inputImageForGeneration,
        referenceImages: undefined,
        generationMode: 'CUT'
    };
};

// --- Module: CharacterRef (角色迁移) ---
export const processCharacterRef = async (
    node: AppNode,
    inputs: AppNode[],
    prompt: string
): Promise<StrategyResult> => {
    const videoSource = inputs.find(n => n.data.videoUri);
    const characterImage = inputs.find(n => n.data.image)?.data.image || null;

    let motionDescription = "";
    if (videoSource?.data.videoUri) {
        try {
            let vidData = videoSource.data.videoUri;
            if (vidData.startsWith('http')) vidData = await urlToBase64(vidData);
            motionDescription = await analyzeVideo(vidData, "Describe only the motion and camera movement.", "gemini-3-flash-preview");
        } catch (e) { }
    }

    let finalPrompt = motionDescription ? `Motion: ${motionDescription}. ${prompt}` : prompt;

    return {
        finalPrompt,
        videoInput: null,
        inputImageForGeneration: characterImage,
        referenceImages: undefined,
        generationMode: 'CHARACTER_REF'
    };
};

// --- Main Factory ---
export const getGenerationStrategy = async (
    node: AppNode, 
    inputs: AppNode[], 
    basePrompt: string
): Promise<StrategyResult> => {
    const mode = node.data.generationMode || 'DEFAULT';

    switch (mode) {
        case 'CHARACTER_REF':
            return processCharacterRef(node, inputs, basePrompt);
        case 'FIRST_LAST_FRAME':
            return processFrameWeaver(node, inputs, basePrompt);
        case 'CUT':
            return processSceneDirector(node, inputs, basePrompt);
        case 'CONTINUE':
            return processStoryContinuator(node, inputs, basePrompt);
        case 'DEFAULT':
        default:
            return processDefaultVideoGen(node, inputs, basePrompt);
    }
};