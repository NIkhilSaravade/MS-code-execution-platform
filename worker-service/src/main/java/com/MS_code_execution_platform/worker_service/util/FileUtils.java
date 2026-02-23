package com.MS_code_execution_platform.worker_service.util;

import org.springframework.util.FileSystemUtils;

import java.io.IOException;
import java.nio.file.*;

public class FileUtils {

    public static Path createTempDirectory(Long submissionId) throws IOException {

        Path baseDir = Paths.get("docker-code");

        if (!Files.exists(baseDir)) {
            Files.createDirectories(baseDir);
        }

        Path submissionDir = baseDir.resolve("submission_" + submissionId);

        if (Files.exists(submissionDir)) {
            FileSystemUtils.deleteRecursively(submissionDir);
        }

        Files.createDirectories(submissionDir);

        return submissionDir.toAbsolutePath();
    }

    public static Path writeCodeFile(Path dir, String filename, String code) throws IOException {
        Path filePath = dir.resolve(filename);
        Files.writeString(filePath, code);
        return filePath;
    }

    public static void deleteDirectory(Path path) throws IOException {
        Files.walk(path)
                .sorted((a, b) -> b.compareTo(a))
                .forEach(p -> p.toFile().delete());
    }
}