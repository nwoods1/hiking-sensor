import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { supabase } from "./supabase.js";
import { askSnowflake } from "./snowflake.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());


app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "Backend is running"
  });
});


// The frontend sends the signed-in user's Supabase access token as
// "Authorization: Bearer <token>". Verify it and return that user,
// or null if it is missing or invalid.
//
// This server's SUPABASE_KEY is a secret key, which bypasses row level
// security, so every hikes query MUST filter by the verified user's id.
async function getRequestUser(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!token) {
    return null;
  }

  const { data, error } =
    await supabase.auth.getUser(token);

  if (error) {
    return null;
  }

  return data.user;
}


async function getUserHikes(userId) {
  const { data, error } =
    await supabase
      .from("hikes")
      .select("*")
      .eq("user_id", userId)
      .order("started_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data;
}


app.get("/hikes", async (req, res) => {
  try {
    const user = await getRequestUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Sign in to see your hikes"
      });
    }

    const data = await getUserHikes(user.id);

    res.json(data);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to load hikes"
    });
  }
});


app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({
        error: "Question is required"
      });
    }

    const user = await getRequestUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Sign in to ask about your hikes"
      });
    }

    // Only the signed-in user's hikes. Drop ids/storage paths the
    // model doesn't need.
    const hikes = (await getUserHikes(user.id)).map(
      ({ id, user_id, data_path, ...hike }) => hike
    );

    if (hikes.length === 0) {
      return res.json({
        answer: "You don't have any saved hikes yet. Record a hike and I can answer questions about it."
      });
    }

    // Send question + hike data to Snowflake Cortex
    const answer =
      await askSnowflake(
        question,
        hikes
      );

    res.json({
      answer
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to answer question"
    });
  }
});


const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Server running at http://localhost:${PORT}`
  );
});