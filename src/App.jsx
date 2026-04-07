import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import "./App.css";

function digitalTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return "00h 00m 00s";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
}

function App() {
  const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

  const [localPath, setLocalPath] = useState("");
  const [files, setFiles] = useState([]);
  const [pages, setPages] = useState("36");
  const [jobs, setJobs] = useState([]); // Array of job objects

  const timerRefs = useRef({}); // Store intervals for each jobId
  const startTimeRefs = useRef({});

  useEffect(() => {
    document.title = "AUS | Examcell PDF Barcode Validator";
  }, []);

  const updateJob = (id, updates) => {
    setJobs(prev => prev.map(job => job.id === id ? { ...job, ...updates } : job));
  };

  const startTimer = (id) => {
    startTimeRefs.current[id] = Date.now();
    timerRefs.current[id] = setInterval(() => {
      const elapsed = (Date.now() - startTimeRefs.current[id]) / 1000;

      setJobs(prev => prev.map(job => {
        if (job.id === id) {
          const avg = job.processed > 0 ? elapsed / job.processed : 0;
          const remaining = avg * (job.total - job.processed);
          return { ...job, elapsed, remaining };
        }
        return job;
      }));
    }, 1000);
  };

  const stopTimer = (id) => {
    if (timerRefs.current[id]) {
      clearInterval(timerRefs.current[id]);
      delete timerRefs.current[id];
    }
  };

  const handleCancel = async (jobId) => {
    updateJob(jobId, { status: "Status: Cancelling... ❌" });
    await axios.post(`${API_BASE_URL}/cancel`, { jobId });
    stopTimer(jobId);
    updateJob(jobId, { status: "Status: Process Cancelled ❌", processing: false });
  };

  const handlePickLocalFolder = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/local-pick`);
      setLocalPath(res.data.folderPath);
      setFiles([]); // Clear browser-selected files to avoid confusion
    } catch (err) {
      alert("Error picking folder: " + err.message);
    }
  };

  const handleSubmit = async () => {
    console.log("Submitting job with files:", files.length, "and pages:", pages);

    if (files.length === 0 && !localPath) {
      alert("Please select a folder first!");
      return;
    }

    if (!pages) {
      alert("Enter valid expected page count!");
      return;
    }

    const newJobId = localPath ? "local_" + Date.now() : "upload_" + Date.now();
    const newJob = {
      id: newJobId,
      name: localPath ? localPath.split(/[\\/]/).pop() : files[0].webkitRelativePath?.split('/')[0] || "Upload",
      status: "Status: Initializing...",
      processed: 0,
      total: 0,
      elapsed: 0,
      remaining: 0,
      localPath: localPath,
      processing: true
    };

    setJobs(prev => [newJob, ...prev]);

    try {
      let finalJobId = newJobId;

      updateJob(newJobId, { status: "Status: Waking up cloud server... (takes up to 50s)" });
      try {
        await axios.get(`${API_BASE_URL}/ping`, { timeout: 120000 });
      } catch (e) {
        console.warn("Server wakeup ping failed or timed out. Proceeding anyway...", e);
      }

      if (!localPath) {
        updateJob(newJobId, { status: "Status: Uploading folder..." });

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
          formData.append("files", files[i]);
        }

        const uploadRes = await axios.post(`${API_BASE_URL}/upload`, formData);
        finalJobId = uploadRes.data.jobId;
        const total = uploadRes.data.totalFiles;
        updateJob(newJobId, { id: finalJobId, total });
      } else {
        updateJob(newJobId, { status: "Status: Using local folder path..." });
      }

      const activeJobId = finalJobId;

      // Start SSE
      const eventSource = new EventSource(`${API_BASE_URL}/progress/${activeJobId}`);

      eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'total') {
          updateJob(newJobId, { total: data.total });
          startTimer(newJobId);
        } else if (data.type === 'processed') {
          setJobs(prev => prev.map(job =>
            job.id === newJobId || job.id === finalJobId
              ? { ...job, processed: job.processed + 1, status: `Status: Processing ${job.processed + 1}/${job.total} : ${data.file}` }
              : job
          ));
        } else if (data.type === 'done') {
          stopTimer(newJobId);
          updateJob(newJobId, { status: `Status: Completed ✅`, processing: false, remaining: 0 });

          if (!localPath) {
            window.location.href = `${API_BASE_URL}/download/${activeJobId}`;
          }
          eventSource.close();
        } else if (data.type === 'cancelled') {
          stopTimer(newJobId);
          updateJob(newJobId, { status: "Status: Process Cancelled ❌", processing: false });
          eventSource.close();
        } else if (data.type === 'error') {
          stopTimer(newJobId);
          updateJob(newJobId, { status: "Status: Error - " + data.message, processing: false });
          eventSource.close();
        }
      };

      eventSource.onerror = (e) => {
        console.error("SSE Error", e);
      };

      await axios.post(`${API_BASE_URL}/start`, { jobId: activeJobId, pages, localPath });

    } catch (err) {
      console.error("Critical submission error:", err);
      stopTimer(newJobId);
      const msg = err.response?.data?.error || err.message;
      updateJob(newJobId, { status: "Status: Error - " + msg, processing: false });
      alert("Uh oh! We hit an error connecting to the server: " + msg);
    }
  };

















  return (
    <div className="container" style={{ fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif", backgroundColor: "#ffffff" }}>
      <div className="main-content">
        {/* Removed logo to resolve 404 error */}
        <div className="title">Batch PDF Barcode Validator</div>

        {window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? (
          <>
            <div className="folder-status">
              {localPath ? `📂 Selected Local Folder: ${localPath}` : "No local folder selected"}
            </div>
            <button className="btn" style={{ backgroundColor: "#004883", marginBottom: "10px" }} onClick={handlePickLocalFolder}>
              Select Local Folder
            </button>
          </>
        ) : (
          <>
            <input
              id="folder-input"
              type="file"
              webkitdirectory="true"
              directory="true"
              multiple
              className="hidden-input"
              onChange={(e) => {
                setFiles(e.target.files);
                setLocalPath(""); // Clear local path if using browser upload
              }}
            />
            <label htmlFor="folder-input" className="btn">
              Select Folder to Upload
            </label>
            <div className="folder-status">
              {files.length > 0 ? `Selected Folder: ${files[0].webkitRelativePath?.split('/')[0] || 'Unknown'} | Total PDFs: ${files.length}` : "No folder selected"}
            </div>
          </>
        )}

        <div className="label" htmlFor="page-count">Enter Expected Page Count:</div>
        <input
          id="page-count"
          name="pages"
          type="number"
          className="input-box"
          value={pages}
          onChange={(e) => setPages(e.target.value)}
        />

        <button
          className="btn submit-btn"
          style={{ backgroundColor: "#004883", cursor: "pointer" }}
          onClick={handleSubmit}
        >
          Add to Queue
        </button>

        {jobs.length > 0 && (
          <div className="jobs-container">
            <div className="section-title">Job Queue</div>
            {jobs.map(job => (
              <div key={job.id} className="job-card">
                <div className="job-header">
                  <span className="job-name">{job.name}</span>
                  <span className="job-status-text">{job.status}</span>
                </div>

                <div className="progress-bar-container">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${job.total > 0 ? (job.processed / job.total) * 100 : 0}%` }}
                  ></div>
                </div>

                <div className="job-stats">
                  <span>Processed: {job.processed} / {job.total}</span>
                  <span>Elapsed: {digitalTime(job.elapsed)}</span>
                  <span>Remaining: {digitalTime(job.remaining)}</span>
                </div>

                {job.processing && (
                  <button className="cancel-small" onClick={() => handleCancel(job.id)}>Cancel</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="footer">
        Developed by IT Applications
      </div>
    </div>
  );
}

export default App;