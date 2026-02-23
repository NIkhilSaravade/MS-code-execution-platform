package com.MS_code_execution_service.execution_result_service;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;

@SpringBootApplication
@EnableFeignClients
@EnableDiscoveryClient
public class ExecutionResultServiceApplication {

	public static void main(String[] args) {
		SpringApplication.run(ExecutionResultServiceApplication.class, args);
	}

}
