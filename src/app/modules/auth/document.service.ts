import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { User } from '../user/user.model';


export const uploadDocumentImagesToDB = async (userId: string, files: Express.Multer.File[]) => {
  if (!files || files.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'No files uploaded');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  // Save file paths (adjust according to your storage strategy)
  const imagePaths = files.map((file) => file.path);
  user.documentVerified = (user.documentVerified || []).concat(imagePaths);

  // You can generate a new access token if needed; omitted here for simplicity
  await user.save();

  return { documentVerified: user.documentVerified };
};
