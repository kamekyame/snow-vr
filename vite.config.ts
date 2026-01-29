import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "node:path";

export default defineConfig({
	plugins: [basicSsl()],
	root: ".",
	base: "/snow-vr/",
	build: {
		rollupOptions: {
			input: resolve(__dirname, "index.html"),
		},
	},
});
