// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DigitalSlotMachine} from "../src/DigitalSlotMachine.sol";

contract DeployBase is Script {
    uint256 public constant BASE_MAINNET_CHAIN_ID = 8_453;
    address public constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external returns (DigitalSlotMachine slot) {
        require(block.chainid == BASE_MAINNET_CHAIN_ID, "DeployBase: wrong chain");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address initialOwner = vm.envOr("INITIAL_OWNER", deployer);
        uint256 ticketPrice = vm.envOr("TICKET_PRICE", uint256(1_000_000));
        vm.startBroadcast(deployerKey);
        slot = new DigitalSlotMachine(initialOwner, IERC20(BASE_USDC), ticketPrice);
        vm.stopBroadcast();
    }
}
