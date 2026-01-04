import { Routes, Route } from "react-router-dom";
import ThreePanelLayout from "./layout/ThreePanelLayout";
import ReEntry from "./screens/ReEntry";

export default function App() {
  return (
    <ThreePanelLayout>
      <Routes>
        <Route path="/" element={<ReEntry />} />
      </Routes>
    </ThreePanelLayout>
  );
}
