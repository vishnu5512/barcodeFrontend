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
  const [folderPath, setFolderPath] = useState("");
  const [pages, setPages] = useState("");
  const [status, setStatus] = useState("Status: Waiting for folder upload...");
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [elapsedTimer, setElapsedTimer] = useState(0);
  const [remainingTimer, setRemainingTimer] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  
  const jobIdRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const processedRef = useRef(0);
  const totalRef = useRef(0);

  useEffect(() => {
    document.title = "AUS | Examcell PDF Barcode Validator";
  }, []);

  const handleSelectFolder = async () => {
    try {
        const res = await axios.get("http://localhost:5000/select-folder");
        if (res.data.folderPath) {
            setFolderPath(res.data.folderPath);
            setStatus(`Status: Selected Folder Ready`);
        }
    } catch (err) {
        alert("Could not open folder picker.");
    }
  };

  const startTimer = () => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      setElapsedTimer(elapsed);
      
      const currentProcessed = processedRef.current;
      const currentTotal = totalRef.current;
      
      if (currentProcessed > 0) {
        const avg = elapsed / currentProcessed;
        const remaining = avg * (currentTotal - currentProcessed);
        setRemainingTimer(remaining);
      } else {
        setRemainingTimer(0);
      }
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleCancel = async () => {
    if (jobIdRef.current) {
        setStatus("Status: Cancelling... ❌");
        await axios.post("http://localhost:5000/cancel", { jobId: jobIdRef.current });
        stopTimer();
        setIsProcessing(false);
        setStatus("Status: Process Cancelled ❌");
    }
  };

  const handleSubmit = async () => {
    if (isProcessing) {
      handleCancel();
      return;
    }

    if (!folderPath) {
      alert("Please select a folder first!");
      return;
    }
    
    if (!pages) {
      alert("Enter valid expected page count!");
      return;
    }

    setIsProcessing(true);
    setElapsedTimer(0);
    setRemainingTimer(0);
    setProcessedCount(0);
    setTotalFiles(0);
    processedRef.current = 0;
    totalRef.current = 0;
    
    try {
      setStatus("Status: Starting validation...");
      const jobId = Date.now().toString();
      jobIdRef.current = jobId;

      // Start SSE
      const eventSource = new EventSource(`http://localhost:5000/progress/${jobId}`);
      
      eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'total') {
            totalRef.current = data.total;
            setTotalFiles(data.total);
            startTimer();
        } else if (data.type === 'processed') {
          processedRef.current += 1;
          setProcessedCount(processedRef.current);
          setStatus(`Status: Processing ${processedRef.current}/${totalRef.current} : ${data.file}`);
        } else if (data.type === 'done') {
          stopTimer();
          setIsProcessing(false);
          setStatus(`Status: Completed ✅ | Total PDFs Processed: ${processedRef.current} of ${totalRef.current}`);
          setRemainingTimer(0); // Show 00h 00m 00s remaining
          
          setTimeout(() => {
              alert("Report Generated:\n" + data.report);
          }, 100);
          eventSource.close();
        } else if (data.type === 'cancelled') {
          stopTimer();
          setIsProcessing(false);
          setStatus("Status: Process Cancelled ❌");
          eventSource.close();
        } else if (data.type === 'error') {
          stopTimer();
          setIsProcessing(false);
          setStatus("Status: Error - " + data.message);
          eventSource.close();
        }
      };

      eventSource.onerror = (e) => {
        console.error("SSE Error", e);
      };

      await axios.post("http://localhost:5000/start", { jobId, folderPath, pages });

    } catch (err) {
      stopTimer();
      setIsProcessing(false);
      setStatus("Status: Error - " + err.message);
      alert("Error: " + err.message);
    }
  };

  return (
    <div className="container" style={{ fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif", backgroundColor: "#ffffff" }}>
      <div className="main-content">
        <img src="/logo.png" alt="Aditya University Logo" className="logo" onError={(e) => e.target.style.display = 'none'} />
        
        <div className="title">Batch PDF Barcode Validator</div>

        <button className="btn" onClick={handleSelectFolder}>
          Select Folder
        </button>
        
        <div className="folder-status">
          {folderPath ? `Selected Folder: ${folderPath.split(/[\\/]/).pop()} | Path: ${folderPath}` : "No folder selected"}
        </div>

        <div className="label">Enter Expected Page Count:</div>
        <input
          type="number"
          className="input-box"
          value={pages}
          onChange={(e) => setPages(e.target.value)}
        />

        <button 
          className="btn submit-btn" 
          style={{ backgroundColor: isProcessing ? "red" : "#004883" }}
          onClick={handleSubmit}
        >
          {isProcessing ? "Cancel" : "Submit"}
        </button>

        <div className="status-blue">{status}</div>
        <div className="status-green">Completed: {digitalTime(elapsedTimer)}</div>
        <div className="status-green">Remaining: {digitalTime(remainingTimer)}</div>
      </div>

      <div className="footer">
        Developed by IT Applications
      </div>
    </div>
  );
}

export default App;