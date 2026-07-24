import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { User } from '../user/user.model';
import { getUploadedFileUrl } from '../../../shared/getFilePath';


export const uploadDocumentImagesToDB = async (userId: string, files: Express.Multer.File[]) => {
  if (!files || files.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'No files uploaded');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  // FIX: Spaces par upload hone ke baad poora URL `file.path` mein hota hai
  const imagePaths = files
    .map((file) => getUploadedFileUrl(file))
    .filter((url): url is string => Boolean(url));
  user.documentVerified = (user.documentVerified || []).concat(imagePaths);

  // You can generate a new access token if needed; omitted here for simplicity
  await user.save();

  return { documentVerified: user.documentVerified };
};