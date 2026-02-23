package com.MS_code_execution_platform.worker_service.service;


import java.util.concurrent.*;

public class TimeoutExecutor {

    public static String execute(ProcessBuilder builder, long timeoutMillis) throws Exception {

        Process process = builder.start();

        ExecutorService executor = Executors.newSingleThreadExecutor();
        Future<String> future = executor.submit(() ->
                new String(process.getInputStream().readAllBytes())
        );

        try {
            return future.get(timeoutMillis, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            process.destroyForcibly();
            throw new RuntimeException("Time Limit Exceeded");
        } finally {
            executor.shutdown();
        }
    }
}