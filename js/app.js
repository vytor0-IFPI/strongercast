/* ============================================================
   Curso de Mentalista — JavaScript
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // Ano automático no rodapé
  const anoEl = document.getElementById("ano");
  if (anoEl) {
    anoEl.textContent = new Date().getFullYear();
  }

  // Menu mobile toggle
  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.querySelector(".nav-links");

  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      navLinks.classList.toggle("active");
      const isOpen = navLinks.classList.contains("active");
      navToggle.setAttribute("aria-expanded", isOpen);
    });

    // Fecha o menu ao clicar em um link
    navLinks.querySelectorAll(".nav-link").forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("active");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Efeito de scroll na navbar
  const navbar = document.getElementById("navbar");
  let lastScrollY = window.scrollY;

  window.addEventListener("scroll", () => {
    const currentScrollY = window.scrollY;
    if (currentScrollY > 50) {
      navbar.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.3)";
    } else {
      navbar.style.boxShadow = "none";
    }
    lastScrollY = currentScrollY;
  });

  // Smooth scroll para links internos
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      const targetId = this.getAttribute("href");
      if (targetId === "#") return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  // Animação de entrada dos cards de módulo
  const observerOptions = {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px",
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll(".modulo-card").forEach((card) => {
    card.style.opacity = "0";
    card.style.transform = "translateY(30px)";
    card.style.transition = "opacity 0.6s ease, transform 0.6s ease";
    observer.observe(card);
  });
});
