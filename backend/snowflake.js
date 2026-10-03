import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const snowflakeAccountUrl =
  process.env.SNOWFLAKE_ACCOUNT_URL;

const snowflakePat =
  process.env.SNOWFLAKE_PAT;

const snowflakeModel =
  process.env.SNOWFLAKE_MODEL;

if (
  !snowflakeAccountUrl ||
  !snowflakePat ||
  !snowflakeModel
) {
  throw new Error(
    "Missing Snowflake environment variables"
  );
}

const snowflake = new OpenAI({
  apiKey: snowflakePat,
  baseURL:
    `${snowflakeAccountUrl}/api/v2/cortex/v1`
});

export async function askSnowflake(
  question,
  hikeData
) {
  const response =
    await snowflake.chat.completions.create({
      model: snowflakeModel,

      messages: [
        {
          role: "system",
          content:
            `You are a hiking biomechanics data assistant.

Analyze the provided hiking data and answer the user's question.

Use only the supplied data.
Do not invent values.
When comparing hikes, mention the relevant hike names and measurements.`
        },
        {
          role: "user",
          content:
            `Here is the hiking data:

${JSON.stringify(
  hikeData,
  null,
  2
)}

Question:
${question}`
        }
      ]
    });

  return response.choices[0].message.content;
}