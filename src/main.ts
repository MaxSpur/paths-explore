import "leaflet/dist/leaflet.css";
import "./styles.css";
import { createApp } from "./app";

const appElement = document.querySelector<HTMLDivElement>("#app");

if (!appElement) {
  throw new Error("Missing #app element");
}

createApp(appElement);
