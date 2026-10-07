import { FooterMarkup } from "./FooterMarkup";

export function Footer() {
  return (
    <>
      <FooterMarkup />
      <div
        className="py-3 text-center text-xs"
        style={{ backgroundColor: "rgb(4, 8, 26)", color: "rgba(255, 255, 255, 0.45)" }}
      >
        Concept for Unobio — not affiliated
      </div>
    </>
  );
}
