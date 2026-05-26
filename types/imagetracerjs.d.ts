declare module 'imagetracerjs' {
  interface Options {
    numberofcolors?: number
    colorquantcycles?: number
    pathomit?: number
    blurradius?: number
    ltres?: number
    qtres?: number
    scale?: number
    roundcoords?: number
    viewbox?: boolean
    desc?: boolean
    lcpr?: number
    qcpr?: number
  }
  const ImageTracer: {
    imagedataToSVG(imageData: ImageData, options?: Options): string
    imageToSVG(url: string, callback: (svgstr: string) => void, options?: Options): void
  }
  export = ImageTracer
}
