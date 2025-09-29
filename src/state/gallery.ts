import * as WebP from 'react-native-webp-converter'
import {
  cacheDirectory,
  deleteAsync,
  makeDirectoryAsync,
  moveAsync,
} from 'expo-file-system/legacy'
import {
  type Action,
  type ActionCrop,
  manipulateAsync,
  SaveFormat,
} from 'expo-image-manipulator'
import {type SaveOptions} from 'expo-image-manipulator/src/ImageManipulator.types'
import {nanoid} from 'nanoid/non-secure'

import {POST_IMG_MAX} from '#/lib/constants'
import {getImageDim} from '#/lib/media/manip'
import {openCropper} from '#/lib/media/picker'
import {type PickerImage} from '#/lib/media/picker.shared'
import {getDataUriSize} from '#/lib/media/util'

export type ImageTransformation = {
  crop?: ActionCrop['crop']
}

export type ImageMeta = {
  path: string
  width: number
  height: number
  mime: string
}

export type ImageSource = ImageMeta & {
  id: string
}

type ComposerImageBase = {
  alt: string
  source: ImageSource
}
type ComposerImageWithoutTransformation = ComposerImageBase & {
  transformed?: undefined
  manips?: undefined
}
type ComposerImageWithTransformation = ComposerImageBase & {
  transformed: ImageMeta
  manips?: ImageTransformation
}

export type ComposerImage =
  | ComposerImageWithoutTransformation
  | ComposerImageWithTransformation

let _imageCacheDirectory: string

function getImageCacheDirectory(): string | null {
  return (_imageCacheDirectory ??= joinPath(cacheDirectory!, 'bsky-composer'))
}

export async function createComposerImage(
  raw: ImageMeta,
): Promise<ComposerImageWithoutTransformation> {
  return {
    alt: '',
    source: {
      id: nanoid(),
      path: await moveIfNecessary(raw.path),
      width: raw.width,
      height: raw.height,
      mime: raw.mime,
    },
  }
}

export type InitialImage = {
  uri: string
  width: number
  height: number
  altText?: string
}

export function createInitialImages(
  uris: InitialImage[] = [],
): ComposerImageWithoutTransformation[] {
  return uris.map(({uri, width, height, altText = ''}) => {
    return {
      alt: altText,
      source: {
        id: nanoid(),
        path: uri,
        width: width,
        height: height,
        mime: 'image/png',
      },
    }
  })
}

export async function pasteImage(
  uri: string,
): Promise<ComposerImageWithoutTransformation> {
  const {width, height} = await getImageDim(uri)
  const match = /^data:(.+?);/.exec(uri)

  return {
    alt: '',
    source: {
      id: nanoid(),
      path: uri,
      width: width,
      height: height,
      mime: match ? match[1] : 'image/png',
    },
  }
}

export async function cropImage(img: ComposerImage): Promise<ComposerImage> {
  const source = img.source

  // @todo: we're always passing the original image here, does image-cropper
  // allows for setting initial crop dimensions? -mary
  try {
    const cropped = await openCropper({
      imageUri: source.path,
    })

    return {
      alt: img.alt,
      source: source,
      transformed: {
        path: await moveIfNecessary(cropped.path),
        width: cropped.width,
        height: cropped.height,
        mime: cropped.mime,
      },
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('User cancelled')) {
      return img
    }

    throw e
  }
}

export async function manipulateImage(
  img: ComposerImage,
  trans: ImageTransformation,
): Promise<ComposerImage> {
  const rawActions: (Action | undefined)[] = [trans.crop && {crop: trans.crop}]

  const actions = rawActions.filter((a): a is Action => a !== undefined)

  if (actions.length === 0) {
    if (img.transformed === undefined) {
      return img
    }

    return {alt: img.alt, source: img.source}
  }

  const source = img.source
  const result = await manipulateAsync(source.path, actions, {
    format: SaveFormat.PNG,
  })

  return {
    alt: img.alt,
    source: img.source,
    transformed: {
      path: await moveIfNecessary(result.uri),
      width: result.width,
      height: result.height,
      mime: 'image/png',
    },
    manips: trans,
  }
}

export function resetImageManipulation(
  img: ComposerImage,
): ComposerImageWithoutTransformation {
  if (img.transformed !== undefined) {
    return {alt: img.alt, source: img.source}
  }

  return img
}

export async function compressImage(
  img: ComposerImage,
  webp: boolean = false,
): Promise<PickerImage> {
  const source = img.transformed || img.source
  const originalSize = getDataUriSize(img.source.path)
  const ogSizeLimit = originalSize * (webp ? 1 : 1.25)

  const [w, h] = containImageRes(source.width, source.height, POST_IMG_MAX)

  let maxQualityPercentage =
    110 - (originalSize >= POST_IMG_MAX.size * 2 ? 10 : 0)
  let newDataUri

  const resizedImage = await manipulateAsync(
    source.path,
    [{resize: {width: w, height: h}}],
    {format: SaveFormat.PNG},
  )

  while (maxQualityPercentage > 1) {
    const qualityPercentage = Math.round(maxQualityPercentage - 10)

    const format = webp
      ? SaveFormat.WEBP
      : qualityPercentage
        ? SaveFormat.PNG
        : SaveFormat.JPEG

    const res = webp
      ? await manipulateWebp(resizedImage.uri, {
          compress: qualityPercentage,
          format: SaveFormat.WEBP,
        })
      : await manipulateAsync(source.path, [], {
          compress: qualityPercentage / 100,
          format,
          base64: true,
        })

    const size = 'size' in res ? res.size : getDataUriSize(res.base64!)

    if (size <= POST_IMG_MAX.size && size <= ogSizeLimit) {
      newDataUri = {
        path: await moveIfNecessary(res.uri),
        width: w,
        height: h,
        mime: `image/${format}`,
        size: size,
        quality: qualityPercentage,
      }
      break
    } else {
      maxQualityPercentage = qualityPercentage
    }
  }

  if (newDataUri) {
    return newDataUri
  }

  throw new Error(`Unable to compress image`)
}

export const manipulateWebp = async (
  uri: string,
  saveOptions: SaveOptions = {},
): Promise<{uri: string; size: number}> => {
  const tempOut = (await getTemporaryImageFile()) as string

  const resultUri = await WebP.convertImage(uri, tempOut, {
    type: saveOptions.compress === 100 ? WebP.Type.LOSSLESS : WebP.Type.LOSSY,
    quality: saveOptions.compress || 100,
  })

  const blob = await (await fetch(resultUri)).blob()

  return {
    uri: resultUri,
    size: blob.size,
  }
}

async function moveIfNecessary(from: string) {
  const cacheDir = getImageCacheDirectory()

  if (cacheDir && from.startsWith(cacheDir)) {
    const to = joinPath(cacheDir, nanoid(36))

    await makeDirectoryAsync(cacheDir, {intermediates: true})
    await moveAsync({from, to})

    return to
  }

  return from
}

async function getTemporaryImageFile() {
  const cacheDir = getImageCacheDirectory()

  if (cacheDir) {
    const path = joinPath(cacheDir, nanoid(36))

    await makeDirectoryAsync(cacheDir, {intermediates: true})

    return path
  }
}

/** Purge files that were created to accomodate image manipulation */
export async function purgeTemporaryImageFiles() {
  const cacheDir = getImageCacheDirectory()

  if (cacheDir) {
    await deleteAsync(cacheDir, {idempotent: true})
    await makeDirectoryAsync(cacheDir)
  }
}

function joinPath(a: string, b: string) {
  if (a.endsWith('/')) {
    if (b.startsWith('/')) {
      return a.slice(0, -1) + b
    }
    return a + b
  } else if (b.startsWith('/')) {
    return a + b
  }
  return a + '/' + b
}

function containImageRes(
  w: number,
  h: number,
  {width: maxW, height: maxH}: {width: number; height: number},
): [width: number, height: number] {
  let scale = 1

  if (w > maxW || h > maxH) {
    scale = w > h ? maxW / w : maxH / h
    w = Math.floor(w * scale)
    h = Math.floor(h * scale)
  }

  return [w, h]
}
