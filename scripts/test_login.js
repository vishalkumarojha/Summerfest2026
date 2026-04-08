"use strict";
require("dotenv").config({ path: "/home/arno/Desktop/Projects/ticketsys/summerfest2026/.env" });
const { supabase } = require("./db");
const bcrypt = require("bcryptjs");

async function run() {
  const username = "scanner1";
  const password = "password"; // irrelevant for the crash test
  
  try {
    let role = "admin";
    let { data: user, error: err1 } = await supabase
      .from("admins").select("*").eq("username", username).single();

    console.log("Admins query:", { user, err1 });

    if (!user) {
      role = "scanner";
      let res2 = await supabase
        .from("scanners").select("*").eq("username", username).single();
      console.log("Scanners query full:", res2);
      user = res2.data;
    }

    console.log("Final user:", user);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
      console.log("Returns 401 Invalid credentials");
    } else {
      console.log("Returns 200 Success");
    }
  } catch(e) {
    console.error("CAUGHT EXCEPTION:", e);
  }
}
run();
