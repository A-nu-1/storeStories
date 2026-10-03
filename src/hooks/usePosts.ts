import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase/client";
import {
  getSignedPostImageUrl,
  uploadPostImage,
} from "@/lib/supabase/storage";
import { useEffect, useState } from "react";

export interface PostUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
}

export interface Post {
  id: string;
  user_id: string;

  // In the UI this contains a temporary signed URL.
  image_url: string;

  description?: string;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  profiles?: PostUser | null;
}

export const usePosts = () => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] =
    useState(true);

  const { user } = useAuth();

  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async () => {
    if (!user) return;

    setIsLoading(true);

    try {
      const {
        data: postsData,
        error: postsError,
      } = await supabase
        .from("posts")
        .select("*")
        .eq("is_active", true)
        .gt(
          "expires_at",
          new Date().toISOString(),
        )
        .order("created_at", {
          ascending: false,
        });

      if (postsError) {
        console.error(
          "Error loading posts:",
          postsError,
        );
        throw postsError;
      }

      if (
        !postsData ||
        postsData.length === 0
      ) {
        setPosts([]);
        return;
      }

      const userIds = [
        ...new Set(
          postsData
            .map((post) => post.user_id)
            .filter(
              (
                userId,
              ): userId is string =>
                Boolean(userId),
            ),
        ),
      ];

      const profilesById =
        new Map<string, PostUser>();

      if (userIds.length > 0) {
        const {
          data: profilesData,
          error: profilesError,
        } = await supabase
          .from("profiles")
          .select(
            "id, name, username, profile_image_url",
          )
          .in("id", userIds);

        if (profilesError) {
          console.error(
            "Error loading post profiles:",
            profilesError,
          );
          throw profilesError;
        }

        for (
          const profile of profilesData ?? []
        ) {
          profilesById.set(
            profile.id,
            profile,
          );
        }
      }

      // Convert the stored Storage paths into
      // temporary signed URLs for display.
      const postsWithSignedUrls =
        await Promise.all(
          postsData.map(async (post) => {
            try {
              const signedUrl =
                await getSignedPostImageUrl(
                  post.image_url,
                );

              return {
                ...post,
                image_url: signedUrl,
                profiles:
                  profilesById.get(
                    post.user_id,
                  ) || null,
              };
            } catch (error) {
              console.error(
                `Could not create signed URL for post ${post.id}:`,
                error,
              );

              return null;
            }
          }),
        );

      const validPosts =
        postsWithSignedUrls.filter(
          (
            post,
          ): post is NonNullable<
            typeof post
          > => post !== null,
        );

      setPosts(validPosts);
    } catch (error) {
      console.error(
        "Error in loadPosts:",
        error,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const createPost = async (
    imageUri: string,
    description?: string,
  ) => {
    if (!user) {
      throw new Error(
        "User not authenticated",
      );
    }

    try {
      // IMPORTANT:
      // We deliberately do NOT deactivate older posts.
      // A user can have multiple active posts,
      // each with its own 24-hour expiry.

      const imagePath =
        await uploadPostImage(
          user.id,
          imageUri,
        );

      const now = new Date();

      const expiresAt = new Date(
        now.getTime() +
          24 * 60 * 60 * 1000,
      );

      const { error } = await supabase
        .from("posts")
        .insert({
          user_id: user.id,

          // Despite the legacy column name image_url,
          // new rows store the Storage object path.
          image_url: imagePath,

          description:
            description || null,

          expires_at:
            expiresAt.toISOString(),

          is_active: true,
        });

      if (error) {
        console.error(
          "Error creating post:",
          error,
        );

        // Prevent an orphaned Storage image if
        // inserting the DB row fails.
        const {
          error: cleanupError,
        } = await supabase.storage
          .from("posts")
          .remove([imagePath]);

        if (cleanupError) {
          console.error(
            "Could not clean up uploaded image after failed post creation:",
            cleanupError,
          );
        }

        throw error;
      }

      await loadPosts();
    } catch (error) {
      console.error(
        "Error in createPost:",
        error,
      );
      throw error;
    }
  };

  const refreshPosts = async () => {
    await loadPosts();
  };

  return {
    createPost,
    posts,
    refreshPosts,
  };
};