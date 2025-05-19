import {
  Page,
  Card,
  Button,
  Text,
  Banner,
  Layout,
  FormLayout,
  Spinner,
  ProgressBar,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import io from "socket.io-client";

const socket = io("http://localhost:6004");

export default function SettingsPage() {
  const [shopDomain, setShopDomain] = useState("");
  const [progress, setProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [estimatedTime, setEstimatedTime] = useState("Calculating...");
  const [file, setFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [startTime, setStartTime] = useState(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shopOrigin = urlParams.get("shop");
    if (shopOrigin) {
      const cleanedShopUrl = shopOrigin
        .replace("https://", "")
        .replace("www.", "");
      setShopDomain(cleanedShopUrl);
    }

    socket.on("connect", () => {
      console.log("Connected to WebSocket server");
    });

    socket.on("jobProgress", (data) => {
      if (data.jobId === jobId || !jobId) {
        setProgress(data.progress);
        setJobId(data.jobId);

        if (startTime) {
          setEstimatedTime(calculateDynamicETR(data.progress));
        }
      }
    });

    socket.on("jobCompleted", (data) => {
      if (data.jobId === jobId) {
        setProgress(100);
        setUploadStatus("Upload and processing completed successfully!");
        setLoading(false);
        setEstimatedTime("");
        setJobId(null);
      }
    });

    return () => {
      socket.off("jobProgress");
      socket.off("jobCompleted");
    };
  }, [jobId, startTime]);

  const calculateDynamicETR = (progress) => {
    if (!startTime || progress === 0) {
      return "Calculating...";
    }
    const timeElapsed = (new Date().getTime() - startTime) / 1000;
    const estimatedTotalTime = (timeElapsed / progress) * 100;
    const timeRemaining = Math.max(estimatedTotalTime - timeElapsed, 0);
    return `${Math.round(timeRemaining)} seconds remaining`;
  };

  const handleSubmit = async () => {
    if (!file) {
      alert("Please select a file first");
      return;
    }
    if (!shopDomain) {
      alert("Shop domain is missing");
      return;
    }

    setLoading(true);
    setProgress(0);
    setUploadStatus("Uploading file...");
    setEstimatedTime("Calculating...");
    setStartTime(new Date().getTime());
    setJobId(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("http://localhost:6004/upload", {
        method: "POST",
        headers: {
          "shop-domain": shopDomain,
        },
        body: formData,
      });

      if (response.ok) {
        setUploadStatus("File uploaded. Processing started...");
      } else {
        const errorData = await response.json();
        setUploadStatus(
          `Upload failed: ${errorData.message || "Unknown error"}`,
        );
        setLoading(false);
        setEstimatedTime("");
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      setUploadStatus("Upload failed due to network/server error.");
      setLoading(false);
      setEstimatedTime("");
    }
  };

  const resetForm = () => {
    setFile(null);
    setProgress(0);
    setUploadStatus("");
    setLoading(false);
    setEstimatedTime("");
    setJobId(null);
    setStartTime(null);
  };

  return (
    <Page title="Inventory Upload">
      <Layout>
        <Layout.Section>
          <Card title="Upload Inventory File" sectioned>
            <FormLayout>
              <div style={{ position: "relative" }}>
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files[0])}
                  style={{
                    padding: "10px",
                    fontSize: "14px",
                    border: "1px solid #ccc",
                    borderRadius: "5px",
                    width: "100%",
                    cursor: "pointer",
                    marginBottom: "10px",
                  }}
                  disabled={loading}
                />
                <Text
                  variant="bodyMd"
                  color="subdued"
                  style={{ position: "absolute", top: "40px", left: "10px" }}
                >
                  Select your CSV file
                </Text>
              </div>
              <Button
                submit
                primary
                onClick={handleSubmit}
                disabled={loading || !shopDomain || !file}
                fullWidth
              >
                {loading ? "Uploading & Processing..." : "Upload File"}
              </Button>
            </FormLayout>

            {loading && (
              <div style={{ marginTop: "20px" }}>
                <Spinner size="small" color="success" />
                <Text
                  variant="bodyLg"
                  color="subdued"
                  align="center"
                  style={{ marginTop: "10px" }}
                >
                  Processing, please wait...
                </Text>
                <ProgressBar progress={progress} size="large" />
                <Text align="center" style={{ marginTop: "10px" }}>
                  {estimatedTime}
                </Text>
              </div>
            )}

            {uploadStatus && (
              <Banner
                status={
                  uploadStatus.includes("completed")
                    ? "success"
                    : uploadStatus.includes("failed")
                      ? "critical"
                      : "info"
                }
                onDismiss={() => setUploadStatus("")}
              >
                <Text variant="bodyMd" align="center">
                  {uploadStatus}
                </Text>
                {(uploadStatus.includes("completed") ||
                  uploadStatus.includes("failed")) && (
                  <Button onClick={resetForm} plain>
                    {uploadStatus.includes("completed")
                      ? "Upload Another"
                      : "Try Again"}
                  </Button>
                )}
              </Banner>
            )}
          </Card>
        </Layout.Section>

        <Layout.Section>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              width: "50%",
              margin: "1.5rem 0 0 0",
              padding: "20px",
              backgroundColor: "#ffffff",
              borderRadius: "12px",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
              textAlign: "Left",
              fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
              fontSize: "20px",
            }}
          >
            <Card
              title="Sample CSV File"
              sectioned
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "8px",
                boxShadow: "0 3px 8px rgb(0 0 0 / 0.15)",
                marginTop: "1.5rem",
                padding: "16px",
                textAlign: "center",
              }}
            >
              <Text
                variant="bodyMd"
                color="subdued"
                style={{ marginBottom: "1rem", fontSize: "50px" }}
              >
                Download sample CSV
              </Text>
              <Button
                primary
                onClick={() =>
                  window.open("/sample-csv/inventory-sample.csv", "_blank")
                }
              >
                Download Sample CSV
              </Button>
            </Card>
          </div>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
