import {isNative} from '#/platform/detection'

export const IMAGE_FORMATS = [
  {label: 'AVIF', value: 'avif'},
  {label: 'WebP', value: 'webp'},
  {label: 'JPEG', value: 'jpeg'},
  {label: 'PNG', value: 'png'},
  {label: 'GIF', value: 'gif'},
  {label: 'BMP', value: 'bmp'},
  {label: 'ICO', value: 'ico'},
  {label: 'JPEG XL', value: 'jxl'},
  ...(isNative ? [{label: 'HEIC', value: 'heic'}] : []),
]
