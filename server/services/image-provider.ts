import * as segmindImage from './segmind-image.js';
import { getImageModel } from '../../constants/imageModels.js';

export const getImageService = (_imageModel: string | undefined | null) =>
  segmindImage;

export const getImageGenerationModelName = (imageModel: string | undefined | null) =>
  getImageModel(imageModel).runtimeModel;

export const getStyleOptionsModelName = (imageModel: string | undefined | null) =>
  getImageModel(imageModel).runtimeModel;
