import { supabase } from "./supabase.js";

// quick connection check: should return [] (empty table), not an error
const { data, error } = await supabase.from("hikes").select("*");
console.log({ data, error });