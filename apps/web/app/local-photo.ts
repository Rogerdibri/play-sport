export async function prepareLocalPhoto(file: File, maxLength: number, maxDimension = 640, format: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Elige una imagen JPG, PNG o WebP.');
  if (file.size > 5 * 1024 * 1024) throw new Error('La foto debe pesar como máximo 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new globalThis.Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('No se pudo leer la imagen. Elige un archivo JPG, PNG o WebP válido.'));
      image.src = url;
    });
    if (!image.width || !image.height || image.width * image.height > 40000000) throw new Error('La imagen es demasiado grande o no se puede leer.');
    const canvas = globalThis.document.createElement('canvas');
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('El navegador no permite preparar la foto.');
    if (format === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL(format, 0.75);
    if (data.length > maxLength) throw new Error('La foto sigue siendo muy pesada. Elige una más sencilla.');
    return data;
  } finally { URL.revokeObjectURL(url); }
}
