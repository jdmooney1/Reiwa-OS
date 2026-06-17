import { redirect } from "next/navigation";

// The full deals list lives in the pipeline Table view for now.
export default function DealsPage() {
  redirect("/pipeline");
}
