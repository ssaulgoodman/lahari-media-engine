import * as geminiImage from './imagen.js';
import * as openaiImage from './openai-image.js';
import * as segmindImage from './segmind-image.js';
import { getImageModel, isOpenAIImageModel, isSegmindImageModel } from '../../constants/imageModels.js';

export const getImageService = (imageModel: string | undefined | null) =>
  isOpenAIImageModel(imageModel)
    ? openaiImage
    : isSegmindImageModel(imageModel)
      ? segmindImage
      : geminiImage;

export const getImageGenerationModelName = (imageModel: string | undefined | null) =>
  getImageModel(imageModel).runtimeModel;

export const getStyleOptionsModelName = (imageModel: string | undefined | null) =>
  isOpenAIImageModel(imageModel) || isSegmindImageModel(imageModel)
    ? getImageModel(imageModel).runtimeModel
    : 'imagen-4.0-generate-001';
