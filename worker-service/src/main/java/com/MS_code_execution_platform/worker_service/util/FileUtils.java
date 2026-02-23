package com.MS_code_execution_platform.worker_service.util;

import java.io.IOException;
import java.nio.file.*;

public class FileUtils {

    public static Path createTempDirectory(Long submissionId) throws IOException {
        return Files.createTempDirectory("submission_" + submissionId);
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