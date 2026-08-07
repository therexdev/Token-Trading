/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07090c",
          900: "#0b0e13",
          850: "#10141b",
          800: "#151a23",
          700: "#1d2431",
          600: "#2a3344",
          500: "#3d485e",
          400: "#5b6880",
          300: "#8b98b0",
        },
        up: "#2ebd85",
        down: "#f6465d",
        accent: "#4f8cff",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
