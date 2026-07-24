/**
 * ============================================================
 *  UPLOADED FILE URL HELPERS
 * ============================================================
 *
 * AHEM:
 * Multer ab `memoryStorage` use karta hai (dekhein
 * `src/app/middlewares/fileUploaderHandler.ts`). Us ke baad middleware
 * har file ko DigitalOcean Spaces par upload karta hai aur poora public
 * CDN URL `file.path` mein rakh deta hai.
 *
 * Is ka matlab: `file.filename` ab kabhi set NAHI hota. Purana code jo
 * `/images/${file.filename}` bana raha tha wo DB mein
 * "/images/undefined" save kar raha tha, isi liye upload ke baad
 * koi image show nahi hoti thi.
 *
 * Har controller ab in helpers ko use kare.
 */

/**
 * Aik multer file object se final public URL nikalta hai.
 */
export const getUploadedFileUrl = (file: any): string | undefined => {
  if (!file) return undefined;

  // Naya rasta: middleware ne Spaces par upload karke poora URL yahan rakha hai
  if (typeof file.path === "string" && file.path.trim().length > 0) {
    return file.path;
  }

  // Legacy fallback: agar kabhi diskStorage wapas lagayi jaye
  if (typeof file.filename === "string" && file.filename.trim().length > 0) {
    return `/images/${file.filename}`;
  }

  return undefined;
};

/**
 * req.files mein se aik field ki pehli file ka URL.
 * Example: getSingleFileUrl(req.files, "profile")
 */
export const getSingleFileUrl = (
  files: any,
  fieldName: string
): string | undefined => {
  const field = files && files[fieldName];

  if (Array.isArray(field) && field.length > 0) {
    return getUploadedFileUrl(field[0]);
  }

  return undefined;
};

/**
 * req.files mein se aik field ki tamam files ke URLs.
 */
export const getMultipleFileUrls = (files: any, fieldName: string): string[] => {
  const field = files && files[fieldName];

  if (!Array.isArray(field)) return [];

  return field
    .map((file: any) => getUploadedFileUrl(file))
    .filter((url): url is string => Boolean(url));
};

/**
 * req.files ki saari files (har field) ke URLs, aik hi array mein.
 */
export const getAllFileUrls = (files: any): string[] => {
  if (!files) return [];

  const all: any[] = Array.isArray(files)
    ? files
    : (Object.values(files).flat() as any[]);

  return all
    .map((file: any) => getUploadedFileUrl(file))
    .filter((url): url is string => Boolean(url));
};

/* ------------------------------------------------------------
   Purane naam, taake koi legacy import na toote
------------------------------------------------------------ */

type IFolderName = "image" | "media" | "doc";

export const getSingleFilePath = (files: any, folderName: IFolderName) =>
  getSingleFileUrl(files, folderName);

export const getMultipleFilesPath = (files: any, folderName: IFolderName) => {
  const urls = getMultipleFileUrls(files, folderName);
  return urls.length > 0 ? urls : undefined;
};