import {InteractionManager, View} from 'react-native'
import {
  type AnimatedRef,
  measure,
  type MeasuredDimensions,
  runOnJS,
  runOnUI,
} from 'react-native-reanimated'
import {Image} from 'expo-image'

import {PNG_IMG_MAX_BYTE, PNG_IMG_MAX_SIZE} from '#/lib/constants'
import {modifyImageFormat} from '#/lib/media/util'
import {useLightboxControls} from '#/state/lightbox'
import {useFullsizeFormat} from '#/state/preferences/fullsize-format'
import {useLoadAsPngs} from '#/state/preferences/load-small-pngs'
import {useThumbnailFormat} from '#/state/preferences/thumbnail-format'
import {type Dimensions} from '#/view/com/lightbox/ImageViewing/@types'
import {AutoSizedImage} from '#/view/com/util/images/AutoSizedImage'
import {ImageLayoutGrid} from '#/view/com/util/images/ImageLayoutGrid'
import {atoms as a} from '#/alf'
import {PostEmbedViewContext} from '#/components/Post/Embed/types'
import {
  type BetterImage,
  type BetterImages,
  type EmbedType,
} from '#/types/bsky/post'
import {type CommonProps} from './types'

export function ImageEmbed({
  embed,
  recordEmbed,
  ...rest
}: CommonProps & {
  embed: EmbedType<'images'>
  recordEmbed?: BetterImages | {media?: BetterImages}
}) {
  const {openLightbox} = useLightboxControls()
  const fullsizeFormat = useFullsizeFormat()
  const thumbnailFormat = useThumbnailFormat()
  const loadAsPngs = useLoadAsPngs()
  const {images} = embed.view
  const recordImages = (recordEmbed &&
    (('media' in recordEmbed && recordEmbed?.media?.images) ||
      ('images' in recordEmbed && recordEmbed?.images))) || [{} as BetterImage]

  if (images.length > 0) {
    const items = images.map((img, index) => {
      const recordImage = recordImages[index] ?? []

      const lowRes =
        img.aspectRatio &&
        img.aspectRatio.width <= 1000 &&
        img.aspectRatio.height <= 1000

      const pngSized =
        (loadAsPngs
          ? (recordImage.image.size &&
              recordImage.quality === 100 &&
              recordImage.image.size <= PNG_IMG_MAX_BYTE) ||
            (img.aspectRatio &&
              img.aspectRatio.width <= PNG_IMG_MAX_SIZE &&
              img.aspectRatio.height <= PNG_IMG_MAX_SIZE)
          : false) || false

      // i'm aware of how ridiculous this looks
      // but i think this is the easiest way of doing this
      // and it doesn't look thaaaat bad but yeah
      img.fullsize = modifyImageFormat(
        img.fullsize,
        pngSized ||
          (loadAsPngs &&
            recordImage.quality === 100 &&
            recordImage.image.mime !== 'image/jpeg')
          ? 'png'
          : fullsizeFormat,
      )

      img.thumb =
        pngSized && lowRes
          ? img.fullsize
          : modifyImageFormat(img.thumb, thumbnailFormat)

      return {
        uri: img.fullsize,
        thumbUri: img.thumb,
        alt: img.alt,
        dimensions: img.aspectRatio ?? null,
      }
    })
    const _openLightbox = (
      index: number,
      thumbRects: (MeasuredDimensions | null)[],
      fetchedDims: (Dimensions | null)[],
    ) => {
      openLightbox({
        images: items.map((item, i) => ({
          ...item,
          thumbRect: thumbRects[i] ?? null,
          thumbDimensions: fetchedDims[i] ?? null,
          type: 'image',
        })),
        index,
      })
    }
    const onPress = (
      index: number,
      refs: AnimatedRef<any>[],
      fetchedDims: (Dimensions | null)[],
    ) => {
      runOnUI(() => {
        'worklet'
        const rects: (MeasuredDimensions | null)[] = []
        for (const r of refs) {
          rects.push(measure(r))
        }
        runOnJS(_openLightbox)(index, rects, fetchedDims)
      })()
    }
    const onPressIn = (_: number) => {
      InteractionManager.runAfterInteractions(() => {
        Image.prefetch(items.map(i => i.uri))
      })
    }

    if (images.length === 1) {
      const image = images[0]
      return (
        <View style={[a.mt_sm, rest.style]}>
          <AutoSizedImage
            crop={
              rest.viewContext === PostEmbedViewContext.ThreadHighlighted
                ? 'none'
                : rest.viewContext ===
                    PostEmbedViewContext.FeedEmbedRecordWithMedia
                  ? 'square'
                  : 'constrained'
            }
            image={image}
            onPress={(containerRef, dims) => onPress(0, [containerRef], [dims])}
            onPressIn={() => onPressIn(0)}
            hideBadge={
              rest.viewContext === PostEmbedViewContext.FeedEmbedRecordWithMedia
            }
          />
        </View>
      )
    }

    return (
      <View style={[a.mt_sm, rest.style]}>
        <ImageLayoutGrid
          images={images}
          onPress={onPress}
          onPressIn={onPressIn}
          viewContext={rest.viewContext}
        />
      </View>
    )
  }
}
