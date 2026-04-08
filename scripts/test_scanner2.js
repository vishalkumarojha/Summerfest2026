const { createClient } = require('@supabase/supabase-js');
require("dotenv").config({ path: "/home/arno/Desktop/Projects/ticketsys/summerfest2026/.env" });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function run() {
  const username = "scanner1";
  
  console.log("Querying admins...");
  let { data: user, error: err1 } = await supabase
    .from("admins").select("*").eq("username", username).single();
    
  if (!user) {
    console.log("No admin found. Querying scanners...");
    let res = await supabase
      .from("scanners").select("*").eq("username", username).single();
    console.log("Scanner query result:", res);
    user = res.data;
  }
}
run().catch(console.error);
