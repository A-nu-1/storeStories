import * as FileSystem from "expo-file-system/legacy";
import { supabase } from "./client";

const POSTS_BUCKET = "posts";

const getImageInfo = (imageUri: string) => {
  const uriWithoutQuery = imageUri.split(/[?#]/)[0];
  const extension =
    uriWithoutQuery.split(".").pop()?.toLowerCase() || "jpg";

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
  const base64 = await FileSystem.readAsStringAsync(
    imageUri,
    {
      encoding: FileSystem.EncodingType.Base64,
    },
  );

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
};

export const uploadProfileImage = async (
  userId: string,
  imageUri: string,
) => {
  try {
    const { extension, contentType } =
      getImageInfo(imageUri);

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
    console.error(
      "Error uploading profile image:",
      error,
    );
    throw error;
  }
};

export const uploadPostImage = async (
  userId: string,
  imageUri: string,
) => {
  try {
    const { extension, contentType } =
      getImageInfo(imageUri);

    const filePath =
      `${userId}/${Date.now()}.${extension}`;

    const fileData = await readImage(imageUri);

    const { error } = await supabase.storage
      .from(POSTS_BUCKET)
      .upload(filePath, fileData, {
        contentType,
        upsert: false,
      });

    if (error) {
      throw new Error(
        `Storage upload failed (${error.statusCode ?? "unknown"}): ${error.message}`,
      );
    }

    // Store only the Storage path in the database.
    // Example:
    // user-id/1790944808877.jpeg
    return filePath;
  } catch (error) {
    console.error(
      "Error uploading post image:",
      error,
    );
    throw error;
  }
};

export const getSignedPostImageUrl = async (
  imageValue: string,
) => {
  let storagePath = imageValue;

  // Temporary backwards compatibility for posts that still
  // contain the old public URL format.
  if (
    imageValue.startsWith("http://") ||
    imageValue.startsWith("https://")
  ) {
    const marker =
      `/storage/v1/object/public/${POSTS_BUCKET}/`;

    try {
      const url = new URL(imageValue);
      const markerIndex =
        url.pathname.indexOf(marker);

      if (markerIndex === -1) {
        throw new Error(
          "Could not determine post Storage path.",
        );
      }

      storagePath = decodeURIComponent(
        url.pathname.slice(
          markerIndex + marker.length,
        ),
      );
    } catch (error) {
      console.error(
        "Error parsing post image URL:",
        error,
      );
      throw error;
    }
  }

  const { data, error } = await supabase.storage
    .from(POSTS_BUCKET)
    .createSignedUrl(
      storagePath,
      // Story itself only lives for 24 hours.
      // 1 hour is plenty for each displayed URL.
      60 * 60,
    );

  if (error) {
    throw new Error(
      `Could not create signed post URL: ${error.message}`,
    );
  }

  return data.signedUrl;
};