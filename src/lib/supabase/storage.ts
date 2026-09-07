import { supabase } from "./client";

const getImageInfo = (imageUri: string) => {
  const uriWithoutQuery = imageUri.split(/[?#]/)[0];
  const extension = uriWithoutQuery.split(".").pop()?.toLowerCase() || "jpg";
  const contentType =
    extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "png"
        ? "image/png"
        : extension === "webp"
          ? "image/webp"
          : "image/jpeg";

  return { extension, contentType };
};

const readImage = async (imageUri: string) => {
  const response = await fetch(imageUri);
  if (!response.ok) {
    throw new Error(`Could not read selected image (${response.status})`);
  }

  return response.arrayBuffer();
};

export const uploadProfileImage = async (userId: string, imageUri: string) => {
  try {
    const { extension, contentType } = getImageInfo(imageUri);
    const fileName = `${userId}/profile.${extension}`;
    const fileData = await readImage(imageUri);

    const { error } = await supabase.storage
      .from("profiles")
      .upload(fileName, fileData, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(
        `Storage upload failed (${error.statusCode ?? "unknown"}): ${error.message}`,
      );
    }

    const { data: urlData } = supabase.storage
      .from("profiles")
      .getPublicUrl(fileName);

    return `${urlData.publicUrl}?t=${Date.now()}`;
  } catch (error) {
    console.error("Error uploading profile image:", error);
    throw error;
  }
};

export const uploadPostImage = async (userId: string, imageUri: string) => {
  try {
    const { extension, contentType } = getImageInfo(imageUri);
    const fileName = `${userId}/${Date.now()}.${extension}`;
    const fileData = await readImage(imageUri);

    const { error } = await supabase.storage
      .from("posts")
      .upload(fileName, fileData, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new Error(
        `Storage upload failed (${error.statusCode ?? "unknown"}): ${error.message}`,
      );
    }

    const { data: urlData } = supabase.storage
      .from("posts")
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  } catch (error) {
    console.error("Error uploading post image:", error);
    throw error;
  }
};
