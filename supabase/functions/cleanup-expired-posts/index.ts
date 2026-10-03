import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const POSTS_BUCKET = "posts";

type ExpiredPost = {
  id: string;
  image_url: string;
};

/**
 * Converts:
 *
 * https://PROJECT.supabase.co/storage/v1/object/public/posts/
 * USER_ID/FILE.jpeg
 *
 * into:
 *
 * USER_ID/FILE.jpeg
 */
function getStoragePath(imageValue: string): string | null {
  if (!imageValue) {
    return null;
  }

  // -------------------------------------------------------
  // NEW FORMAT
  // Database already contains the Storage path:
  //
  // USER_ID/FILE.jpeg
  // -------------------------------------------------------

  if (
    !imageValue.startsWith("http://") &&
    !imageValue.startsWith("https://")
  ) {
    return imageValue;
  }

  // -------------------------------------------------------
  // OLD FORMAT
  // Database contains the old public Storage URL.
  //
  // https://PROJECT.supabase.co/
  // storage/v1/object/public/posts/USER_ID/FILE.jpeg
  // -------------------------------------------------------

  try {
    const url = new URL(imageValue);

    const marker =
      `/storage/v1/object/public/${POSTS_BUCKET}/`;

    const markerIndex =
      url.pathname.indexOf(marker);

    if (markerIndex === -1) {
      return null;
    }

    const encodedPath = url.pathname.slice(
      markerIndex + marker.length,
    );

    return decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
}

export default {
  fetch: withSupabase(
    { auth: "secret" },

    async (_req, ctx) => {
      const now = new Date().toISOString();

      console.log(
        `Starting expired post cleanup at ${now}`,
      );

      // -----------------------------------------------------
      // 1. Find all expired posts
      // -----------------------------------------------------

      const {
        data: expiredPosts,
        error: fetchError,
      } = await ctx.supabaseAdmin
        .from("posts")
        .select("id, image_url")
        .lte("expires_at", now);

      if (fetchError) {
        console.error(
          "Failed to fetch expired posts:",
          fetchError,
        );

        return Response.json(
          {
            success: false,
            error: fetchError.message,
          },
          { status: 500 },
        );
      }

      const posts =
        (expiredPosts ?? []) as ExpiredPost[];

      if (posts.length === 0) {
        console.log("No expired posts found.");

        return Response.json({
          success: true,
          found: 0,
          imagesDeleted: 0,
          postsDeleted: 0,
          message: "No expired posts found.",
        });
      }

      console.log(
        `Found ${posts.length} expired post(s).`,
      );

      // -----------------------------------------------------
      // 2. Work out the exact Storage paths
      // -----------------------------------------------------

      const validPosts: Array<{
        id: string;
        storagePath: string;
      }> = [];

      const invalidPosts: Array<{
        id: string;
        imageUrl: string;
      }> = [];

      for (const post of posts) {
        const storagePath = getStoragePath(
          post.image_url,
        );

        if (!storagePath) {
          console.error(
            `Could not determine Storage path for post ${post.id}`,
          );

          invalidPosts.push({
            id: post.id,
            imageUrl: post.image_url,
          });

          continue;
        }

        validPosts.push({
          id: post.id,
          storagePath,
        });
      }

      if (validPosts.length === 0) {
        return Response.json(
          {
            success: false,
            found: posts.length,
            imagesDeleted: 0,
            postsDeleted: 0,
            invalidPosts,
            error:
              "Expired posts were found, but no valid Storage paths could be determined.",
          },
          { status: 500 },
        );
      }

      // -----------------------------------------------------
      // 3. Delete expired images from Supabase Storage
      // -----------------------------------------------------

      const storagePaths = validPosts.map(
        (post) => post.storagePath,
      );

      const {
        data: deletedImages,
        error: storageError,
      } = await ctx.supabaseAdmin.storage
        .from(POSTS_BUCKET)
        .remove(storagePaths);

      if (storageError) {
        console.error(
          "Failed to delete expired images:",
          storageError,
        );

        // IMPORTANT:
        // Do NOT delete DB rows if Storage deletion failed.
        // We want to keep image_url so we can retry later.
        return Response.json(
          {
            success: false,
            found: posts.length,
            imagesDeleted: 0,
            postsDeleted: 0,
            error: storageError.message,
          },
          { status: 500 },
        );
      }

      console.log(
        `Storage cleanup completed for ${storagePaths.length} image(s).`,
      );

      // -----------------------------------------------------
      // 4. Delete corresponding database rows
      // -----------------------------------------------------

      const postIds = validPosts.map(
        (post) => post.id,
      );

      const {
        data: deletedPosts,
        error: deleteError,
      } = await ctx.supabaseAdmin
        .from("posts")
        .delete()
        .in("id", postIds)
        .select("id");

      if (deleteError) {
        console.error(
          "Images were deleted, but DB row deletion failed:",
          deleteError,
        );

        return Response.json(
          {
            success: false,
            found: posts.length,
            imagesDeleted:
              deletedImages?.length ??
              storagePaths.length,
            postsDeleted: 0,
            error:
              "Storage images were deleted, but database rows could not be deleted.",
            databaseError: deleteError.message,
          },
          { status: 500 },
        );
      }

      const deletedPostCount =
        deletedPosts?.length ?? 0;

      console.log(
        `Deleted ${deletedPostCount} expired post row(s).`,
      );

      // -----------------------------------------------------
      // 5. Final result
      // -----------------------------------------------------

      return Response.json({
        success: invalidPosts.length === 0,

        found: posts.length,

        imagesDeleted:
          deletedImages?.length ??
          storagePaths.length,

        postsDeleted: deletedPostCount,

        skipped: invalidPosts.length,

        invalidPosts,

        message:
          invalidPosts.length === 0
            ? "Expired posts cleaned successfully."
            : "Cleanup completed, but some posts were skipped because their Storage paths could not be determined.",
      });
    },
  ),
};