var assert = require("assert");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const BASIC_AUTH = "Basic YWRtaW46MTIzNDU2";  // BASIC_USER=admin && BASIC_PASS=123456

describe("File API Endpoints", function () {
  // Shared state across tests
  let uploadedFileKey;
  let uploadedVideoKey;
  let uploadedFileUrl;

  // 上传
  describe("POST /api/upload", function () {
    it("should upload the file successfully", async function () {
      const filePath = path.join(__dirname, "../public/otterhub-icon.svg");
      const fileBuffer = fs.readFileSync(filePath);

      const form = new FormData();
      form.append("file", fileBuffer, {
        filename: "otterhub-icon.svg",
        contentType: "image/svg+xml",
      });

      // Get headers from form-data and add authorization
      const formHeaders = form.getHeaders();
      const headers = {
        ...formHeaders,
        Authorization: BASIC_AUTH,
      };

      const response = await fetch("http://localhost:8080/api/upload", {
        method: "POST",
        body: form.getBuffer(),
        headers,
      });

      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);
      assert.ok(result.data);

      // Store the uploaded file key for the next test
      // API returns { success: true, data: "img:xxx.svg" } (key only, not full URL)
      uploadedFileKey = result.data;
      uploadedFileUrl = `http://localhost:8080/file/${result.data}`;
    });
  });

  describe("Photo folder endpoints", function () {
    it("should create a named album first and store photos and videos inside it", async function () {
      if (!uploadedFileKey) {
        this.skip();
      }

      let folderId;
      try {
        const createResponse = await fetch("http://localhost:8080/api/folders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: BASIC_AUTH,
          },
          body: JSON.stringify({ name: `Test album ${Date.now()}` }),
        });
        assert.equal(createResponse.status, 200);
        const created = await createResponse.json();
        assert.ok(created.success);
        folderId = created.data.id;

        const assignResponse = await fetch(
          `http://localhost:8080/api/editFileMeta/${uploadedFileKey}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: BASIC_AUTH,
            },
            body: JSON.stringify({ folderId }),
          },
        );
        assert.equal(assignResponse.status, 200);
        assert.ok((await assignResponse.json()).success);

        const videoForm = new FormData();
        videoForm.append("file", Buffer.from("video-bytes"), {
          filename: "album-video.mp4",
          contentType: "video/mp4",
        });
        videoForm.append("folderId", folderId);
        const videoResponse = await fetch("http://localhost:8080/api/upload", {
          method: "POST",
          body: videoForm.getBuffer(),
          headers: { ...videoForm.getHeaders(), Authorization: BASIC_AUTH },
        });
        assert.equal(videoResponse.status, 200);
        const uploadedVideo = await videoResponse.json();
        assert.ok(uploadedVideo.success);
        uploadedVideoKey = uploadedVideo.data;

        const albumMediaResponse = await fetch(
          `http://localhost:8080/api/folders/${folderId}/files`,
          { headers: { Authorization: BASIC_AUTH } },
        );
        assert.equal(albumMediaResponse.status, 200);
        const albumMedia = await albumMediaResponse.json();
        assert.deepEqual(
          new Set(albumMedia.data.keys.map((item) => item.name)),
          new Set([uploadedFileKey, uploadedVideoKey]),
        );

        const posterResponse = await fetch(
          `http://localhost:8080/api/folders/${folderId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: BASIC_AUTH,
            },
            body: JSON.stringify({ coverKey: uploadedFileKey }),
          },
        );
        assert.equal(posterResponse.status, 200);
        const updatedFolder = await posterResponse.json();
        assert.equal(updatedFolder.data.coverKey, uploadedFileKey);

        const deleteFolderResponse = await fetch(
          `http://localhost:8080/api/folders/${folderId}`,
          {
            method: "DELETE",
            headers: { Authorization: BASIC_AUTH },
          },
        );
        assert.equal(deleteFolderResponse.status, 200);
        const deletedFolder = await deleteFolderResponse.json();
        assert.ok(deletedFolder.data.detachedKeys.includes(uploadedFileKey));
        assert.ok(deletedFolder.data.detachedKeys.includes(uploadedVideoKey));
        folderId = undefined;

        const listResponse = await fetch("http://localhost:8080/api/list?fileType=img", {
          headers: { Authorization: BASIC_AUTH },
        });
        const fileList = await listResponse.json();
        const photo = fileList.data.keys.find((item) => item.name === uploadedFileKey);
        assert.ok(photo);
        assert.equal(photo.metadata.folderId, undefined);

        const videoListResponse = await fetch("http://localhost:8080/api/list?fileType=video", {
          headers: { Authorization: BASIC_AUTH },
        });
        const videoList = await videoListResponse.json();
        const video = videoList.data.keys.find((item) => item.name === uploadedVideoKey);
        assert.ok(video);
        assert.equal(video.metadata.folderId, undefined);
      } finally {
        if (folderId) {
          await fetch(`http://localhost:8080/api/folders/${folderId}`, {
            method: "DELETE",
            headers: { Authorization: BASIC_AUTH },
          });
        }
      }
    });
  });

  // 获取
  describe("GET /file/:key", function () {
    it("should return the uploaded file without error", async function () {
      // Skip if the upload test didn't store a URL
      if (!uploadedFileKey) {
        this.skip();
      }

      const response = await fetch(
        `http://localhost:8080/file/${uploadedFileKey}`,
        {
          headers: {
            Authorization: BASIC_AUTH,
          },
        },
      );
      assert.equal(response.status, 200);

      // Check that the response is the SVG we uploaded
      const responseText = await response.text();
      assert.ok(
        responseText.includes("otterhub-icon.svg") ||
          responseText.includes("svg"),
      );
    });
  });

  // 删除
  describe("POST /api/delete/:key", function () {
    it("should delete the uploaded file successfully", async function () {
      // Skip if the upload test didn't store a URL
      if (!uploadedFileKey) {
        this.skip();
      }

      const response = await fetch(
        `http://localhost:8080/api/delete/${uploadedFileKey}`,
        {
          method: "POST",
          headers: {
            Authorization: BASIC_AUTH,
          },
        },
      );
      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);

      if (uploadedVideoKey) {
        const videoDelete = await fetch(
          `http://localhost:8080/api/delete/${uploadedVideoKey}`,
          {
            method: "POST",
            headers: { Authorization: BASIC_AUTH },
          },
        );
        assert.equal(videoDelete.status, 200);
        uploadedVideoKey = undefined;
      }
    });
  });
});
