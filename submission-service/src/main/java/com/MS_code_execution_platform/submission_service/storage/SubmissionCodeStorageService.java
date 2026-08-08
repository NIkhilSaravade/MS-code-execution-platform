package com.MS_code_execution_platform.submission_service.storage;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Map;

/**
 * Uploads submitted source code to the platform-artifacts bucket so
 * worker-service-go can fetch it by key (job.CodeS3Key) instead of carrying
 * the raw code inline on the submissions.created.v1 event. Key convention
 * mirrors worker-service-go's own artifact keys (executor.go's
 * uploadArtifacts): submissions/YYYY/MM/DD/{submissionId}/source.<ext>.
 */
@Service
@RequiredArgsConstructor
public class SubmissionCodeStorageService {

    private static final Map<String, String> LANGUAGE_EXTENSIONS = Map.of(
            "python", "py",
            "javascript", "js",
            "java", "java",
            "cpp", "cpp",
            "c", "c",
            "go", "go"
    );

    private final S3Client s3Client;

    @Value("${s3.bucket-artifacts}")
    private String bucket;

    public UploadResult upload(Long submissionId, String language, String code) {
        String content = code == null ? "" : code;
        String hash = sha256Hex(content);
        String key = buildKey(submissionId, language);

        s3Client.putObject(
                PutObjectRequest.builder().bucket(bucket).key(key).build(),
                RequestBody.fromString(content, StandardCharsets.UTF_8));

        return new UploadResult(key, hash);
    }

    private String buildKey(Long submissionId, String language) {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        String ext = LANGUAGE_EXTENSIONS.getOrDefault(
                language == null ? "" : language.toLowerCase(), "txt");
        return "submissions/%04d/%02d/%02d/%d/source.%s".formatted(
                today.getYear(), today.getMonthValue(), today.getDayOfMonth(), submissionId, ext);
    }

    private static String sha256Hex(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(content.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is a JDK-guaranteed algorithm; this can't actually happen.
            throw new IllegalStateException(e);
        }
    }

    public record UploadResult(String s3Key, String codeHash) {}
}
