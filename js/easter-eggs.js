const logo = document.querySelector(".logo > a");
const titleNode = logo && Array.from(logo.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());

if (titleNode) {
    const [name, ...suffix] = titleNode.textContent.split("|");
    const letters = document.createElement("span");
    letters.className = "rainbow-name";
    Array.from(name).forEach((letter, index) => {
        const span = document.createElement("span");
        span.className = "rainbow-letter";
        span.style.setProperty("--letter-index", index);
        span.textContent = letter === " " ? "\u00a0" : letter;
        letters.appendChild(span);
    });
    if (suffix.length) letters.append(`|${suffix.join("|")}`);
    titleNode.replaceWith(letters);
}

document.querySelector(".floppy-trigger").addEventListener("click", () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    for (let i = 0; i < 8; i++) {
        const floppy = document.createElement("span");
        floppy.className = "falling-floppy";
        floppy.setAttribute("aria-hidden", "true");
        floppy.textContent = "💾";
        floppy.style.setProperty("--floppy-x", `${Math.random() * 95}vw`);
        floppy.style.setProperty("--floppy-duration", `${2 + Math.random() * 2}s`);
        floppy.style.setProperty("--floppy-rotation", `${Math.random() * 720 - 360}deg`);
        floppy.addEventListener("animationend", () => floppy.remove(), { once: true });
        document.body.appendChild(floppy);
    }
});
