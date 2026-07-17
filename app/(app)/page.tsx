import { redirect } from "next/navigation";

// Dashboard proper arrives with the modules; accounts is the week-1 home.
export default function Home() {
  redirect("/accounts");
}
