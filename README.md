<div align="center">

<img src="public/prologo.svg" alt="ProTakeoff AI Logo" width="200"/>

# ProTakeoff
### Next-Gen Open Source Estimating Software

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
![Version](https://img.shields.io/badge/version-0.1.0-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/status-active-success?style=for-the-badge)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](http://makeapullrequest.com)

<div align="center">
  
  [![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D5?style=flat&logo=tauri&logoColor=white)](https://tauri.app/)
  [![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev/)
  [![Rust](https://img.shields.io/badge/Rust-1.77+-000000?style=flat&logo=rust&logoColor=white)](https://www.rust-lang.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![TailwindCSS](https://img.shields.io/badge/Tailwind-4.0-38B2AC?style=flat&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

</div>

_Powerful, modern, and free estimating software for contractors and estimators._

<br />

<!-- Download Badges -->
[![Download for macOS](https://img.shields.io/badge/Download-macOS-white?style=for-the-badge&logo=apple&logoColor=black)](https://github.com/ilirkl/protakeoff-ai3/releases/latest)
[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/ilirkl/protakeoff-ai3/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/ilirkl/protakeoff-ai3/releases/latest)

<br />

[View Demo](#) • [Report Bug](https://github.com/ilirkl/protakeoff-ai3/issues) • [Request Feature](https://github.com/ilirkl/protakeoff-ai3/issues)

</div>

---

## 📑 Table of Contents
- [Overview](#-overview)
- [Key Features](#-key-features)
- [Screenshots](#-screenshots)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🚀 Overview

**ProTakeoff** is a cutting-edge, open-source construction estimating software designed to streamline the takeoff and bidding process. Built with **Tauri**, **React**, and **Rust**, it combines the performance of a native desktop application with the flexibility of modern web technologies.

Whether you're a general contractor, subcontractor, or DIY enthusiast, ProTakeoff AI provides the tools you need to calculate materials, labor, and costs with precision.

## ✨ Key Features

### 📐 Digital Takeoffs
Perform accurate takeoffs directly on your PDF plans.
- **Area**: Calculate square footage for flooring, roofing, drywall, etc.
- **Linear**: Measure walls, trimming, curbing, and piping.
- **Count**: track fixtures, outlets, drains, and more.
- **Canvas Tools**: Pan, zoom, and snap-to-lines for pixel-perfect accuracy.

### 💰 Detailed Estimating
Turn your measurements into professional bids.
- **Item Assemblies**: Build complex items (e.g., a "Wall" item that includes studs, drywall, tape, and paint).
- **Formulas**: Use built-in math functions (`Math.ceil`, `Math.max`) to automate calculations.
- **Waste Factors**: Automatically add waste percentages to material quantities.

### 📄 PDF Plan Management
- **Graphical Interface**: Visual plan management.
- **Scaling**: Calibrate each page to its specific scale.
- **Performance**: High-speed PDF rendering for large blueprint files.

### 📚 Templates & Database
- **Reusable Templates**: Save common assemblies and items to reuse across projects.
- **Subcontractor Database**: Manage your contacts and vendors.

### 📤 Reports & Export
- **Professional PDF Proposals**: Generate client-ready quotes.
- **Excel Export**: Export raw data for further analysis or integration with other tools.

## 📸 Screenshots

<div align="center">

> [!NOTE]
> **Takeoff Canvas**  
> *Perform precise measurements on blueprints.*  
> `![Takeoff Canvas](assets/takeoff-screenshot.png)`

> [!NOTE]
> **Estimating View**  
> *Manage items, costs, and assemblies.*  
> `![Estimating View](assets/estimating-screenshot.png)`

</div>

## 🛠 Tech Stack

ProTakeoff AI is built on a modern, high-performance stack:

| Component | Technology | Description |
|-----------|------------|-------------|
| **Frontend** | React 19, TypeScript, TailwindCSS | Fast, responsive UI with type safety. |
| **Backend** | Rust, Tauri v2 | Native performance, secure, and lightweight. |
| **Database** | SQLite | Local, reliable data storage. |
| **Build Tool** | Vite | Lightning-fast development server and building. |

## 📦 Getting Started

### Prerequisites
- **Node.js** (v18+)
- **Rust** (Stable)
- **pnpm** or **npm**

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/ilirkl/protakeoff-ai3.git
   cd protakeoff-ai3
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Run the development server**
   ```bash
   npm run tauri dev
   ```

## 🤝 Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 🌟 Support

Give a ⭐️ if this project helped you!

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
