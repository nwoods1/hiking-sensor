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


app.get("/hikes", async (req, res) => {
  try {
    const { data, error } =
      await supabase
        .from("hikes")
        .select("*");

    if (error) {
      throw error;
    }

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

    // Get hike data from Supabase
    const { data: hikes, error } =
      await supabase
        .from("hikes")
        .select("*");

    if (error) {
      throw error;
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